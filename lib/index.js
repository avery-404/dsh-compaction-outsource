/**
 * DeepSeek Harness plugin: let another AI write the compaction checkpoint.
 *
 * Registers one extra model route, `outsource` (never listed in the model menu). Point a compaction row at it
 * (`summarizationProvider: outsource`, `summarizationModel: auto`) and every compaction, automatic or manual,
 * reads the live choice from `<dataDir>/config.json` and dispatches:
 *
 * - `deepseek`: the stock summarizer call, forwarded to `deepseek-account` / `deepseek-flash` (configurable)
 * - `agy` / `claude` / `codex`: the transcript goes to `helper/outsource_cli.py`, which asks that tool
 * - `off` (or any failure): forwarded to `fallbackProvider` / `fallbackModel`, your normal model
 *
 * The choice is hot: it is read on every call, so switching it never needs a restart. Nothing is sent anywhere
 * while the choice is `off`.
 *
 * @module dsh-compaction-outsource
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import { messagesToText, normalizeCheckpoint, requiredHeadings, splitDirective, validateCheckpoint } from './transcript.js'

export const name = 'compaction-outsource'
export const inject = ['llm']

/** Provider route this plugin registers. */
export const PROVIDER = 'outsource'

const BACKENDS = ['agy', 'deepseek', 'claude', 'codex']
const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'helper', 'outsource_cli.py')
const CODE = 'COMPACTION_OUTSOURCE_ERROR'
/** Plain value of a config leaf (a live-reference leaf exposes `get()`). */
function plain(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value
}

/** Resolve the plugin row into plain settings, applied per call so hot edits take effect. */
export function resolveConfig(config = {}) {
  const text = (v, d) => (typeof plain(v) === 'string' && plain(v).trim() !== '' ? plain(v).trim() : d)
  return {
    dataDir: text(config.dataDir, join(homedir(), '.dsh', 'outsource')),
    python: text(config.python, process.platform === 'win32' ? 'python' : 'python3'),
    deepseekProvider: text(config.deepseekProvider, 'deepseek-account'),
    deepseekModel: text(config.deepseekModel, 'deepseek-flash'),
    fallbackProvider: text(config.fallbackProvider, ''),
    fallbackModel: text(config.fallbackModel, ''),
    timeoutSec: Number(plain(config.timeoutSec)) > 0 ? Number(plain(config.timeoutSec)) : 600,
  }
}

/** Reasoning effort per tool; the first entry is the cheapest and the default. agy has none (it is part of its model name). */
export const EFFORTS = {
  deepseek: ['off', 'low', 'high', 'max'],
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['minimal', 'low', 'medium', 'high'],
}

/** The live choice: `{ backend, model, effort }`. backend is 'off' or agy / deepseek / claude / codex; '' model = the tool's default. */
export function readChoice(cfg) {
  try {
    const raw = JSON.parse(readFileSync(join(cfg.dataDir, 'config.json'), 'utf8'))
    const backend = BACKENDS.includes(raw.backend) ? raw.backend : 'off'
    const model = typeof raw.models?.[backend] === 'string' ? raw.models[backend].trim() : ''
    const wanted = typeof raw.efforts?.[backend] === 'string' ? raw.efforts[backend].trim() : ''
    const allowed = EFFORTS[backend]
    return {
      backend,
      model: /^[\w.:/-]{1,80}$/.test(model) ? model : '',
      effort: allowed === undefined ? '' : (allowed.includes(wanted) ? wanted : allowed[0]),
    }
  } catch {
    return { backend: 'off', model: '', effort: '' }
  }
}

function writeStatus(cfg, entry) {
  try {
    mkdirSync(cfg.dataDir, { recursive: true })
    writeFileSync(join(cfg.dataDir, 'last_compaction.json'), JSON.stringify({ ts: Date.now() / 1000, ...entry }, null, 2), 'utf8')
  } catch { /* status only */ }
}

function logUsage(cfg, backend, inChars, outChars, secs, ok) {
  try {
    mkdirSync(cfg.dataDir, { recursive: true })
    appendFileSync(join(cfg.dataDir, 'usage.jsonl'), `${JSON.stringify({
      ts: Date.now() / 1000, backend, purpose: 'compaction', in_chars: inChars, out_chars: outChars, secs: Math.round(secs * 10) / 10, ok,
    })}\n`, 'utf8')
  } catch { /* status only */ }
}

/** Run `outsource_cli.py summarize` and resolve with the checkpoint text. */
function summarizeWithCli(cfg, backend, { model, effort }, directive, text, signal) {
  const dir = join(cfg.dataDir, 'tmp')
  mkdirSync(dir, { recursive: true })
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const src = join(dir, `compact-${stamp}-in.txt`)
  const dst = join(dir, `compact-${stamp}-out.txt`)
  const instr = join(dir, `compact-${stamp}-instr.txt`)
  writeFileSync(src, text, 'utf8')
  if (directive !== '') writeFileSync(instr, directive, 'utf8')
  const cleanup = () => { for (const f of [src, dst, instr]) { try { rmSync(f, { force: true }) } catch { /* ignore */ } } }
  return new Promise((resolve, reject) => {
    const child = spawn(cfg.python, ['-I', CLI, 'summarize', backend, src, dst, String(cfg.timeoutSec), ...(directive !== '' ? [instr] : [])], {
      windowsHide: true,
      env: {
        ...process.env,
        ...(model ? { [`OUTSOURCE_${backend.toUpperCase()}_MODEL`]: model } : {}),
        ...(effort ? { [`OUTSOURCE_${backend.toUpperCase()}_EFFORT`]: effort } : {}),
      },
    })
    let stderr = ''
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-500) })
    const onAbort = () => child.kill()
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (e) => { cleanup(); reject(e) })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      try {
        if (code !== 0) throw new Error(stderr.trim() || `helper exit ${code}`)
        resolve(readFileSync(dst, 'utf8'))
      } catch (e) {
        reject(e)
      } finally {
        cleanup()
      }
    })
  })
}

function charCount(messages) {
  return messages.reduce((n, m) => n + JSON.stringify(m.content ?? '').length, 0)
}

/** Summarizer route: dispatches each call to the user's live choice. */
export class OutsourceAdapter extends LlmAdapter {
  #ctx
  #config

  /** @param ctx - the harness context (for forwarding to other routes). @param config - the plugin row. */
  constructor(ctx, config) {
    super()
    this.#ctx = ctx
    this.#config = config
  }

  providerInfo(provider) {
    return { id: provider, name: 'Compaction outsource' }
  }

  /** Never advertised: this route exists only for compaction. */
  listModels() {
    return Promise.resolve([])
  }

  resolveModel(provider, model) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  /** Collect every chunk of a forwarded call, so a late failure can still fall back cleanly. */
  async #forward(provider, model, options) {
    if (provider === '') throw new LlmError('dsh-compaction-outsource: fallbackProvider / fallbackModel are not configured', CODE)
    const chunks = []
    for await (const chunk of this.#ctx.llm.stream({ ...options, provider, model })) chunks.push(chunk)
    return chunks
  }

  /**
   * @param options - the assembled compaction request (conversation replay + the summarization directive).
   * @yields harness stream chunks, `finish` last.
   */
  async *stream(options) {
    const cfg = resolveConfig(this.#config)
    const { backend: choice, model: chosenModel, effort } = readChoice(cfg)
    const t0 = Date.now()
    const secs = () => Math.round((Date.now() - t0) / 100) / 10
    if (choice !== 'off') {
      try {
        const { directive, conversation } = splitDirective(options.messages)
        const headings = requiredHeadings(directive)
        const sourceChars = charCount(conversation)
        let raw
        let usageChunk
        let finish = { type: 'finish', reason: { kind: 'stop' } }
        if (choice === 'deepseek') {
          const chunks = await this.#forward(cfg.deepseekProvider, chosenModel || cfg.deepseekModel, { ...options, reasoningEffort: effort })
          raw = chunks.reduce((t, c) => (c.type === 'text-delta' ? t + c.text : t), '')
          usageChunk = chunks.find((c) => c.type === 'usage')
          finish = chunks.find((c) => c.type === 'finish') ?? finish
        } else {
          raw = await summarizeWithCli(cfg, choice, { model: chosenModel, effort }, directive, messagesToText(conversation), options.signal)
        }
        // The checkpoint must look like one the local model would have written: same sections, in order, shorter
        // than the conversation. Anything else is refused here and the main model writes it instead.
        const text = normalizeCheckpoint(raw, headings)
        const verdict = validateCheckpoint(text, headings, sourceChars)
        const usage = usageChunk?.usage
        logUsage(cfg, choice, (usage?.inputTokens ?? usage?.input_tokens ?? 0) * 3 || sourceChars, raw.length, secs(), verdict.ok)
        if (!verdict.ok) throw new Error(`checkpoint rejected: ${verdict.problems.join('; ')}`)
        const chunks = [{ type: 'text-delta', index: 0, text }, ...(usageChunk ? [usageChunk] : []), finish]
        writeStatus(cfg, { backend: choice, model: chosenModel || undefined, effort: effort || undefined, ok: true, secs: secs() })
        yield* chunks
        return
      } catch (error) {
        if (options.signal?.aborted === true) throw error
        const reason = error instanceof Error ? error.message : String(error)
        this.#ctx.logger?.warn?.(`dsh-compaction-outsource: ${choice} failed (${reason}); falling back to ${cfg.fallbackProvider || 'nothing'}`)
        writeStatus(cfg, { backend: choice, ok: false, fallback: 'local', secs: secs(), error: reason.slice(0, 300) })
      }
    } else {
      writeStatus(cfg, { backend: 'local', ok: true })
    }
    yield* await this.#forward(cfg.fallbackProvider, cfg.fallbackModel, options)
  }
}

/**
 * Register the `outsource` summarizer route.
 * @param ctx - the harness context, with the injected `llm` seam.
 * @param config - the live plugin row.
 */
export function apply(ctx, config = {}) {
  return ctx.llm.registerAdapter([PROVIDER], new OutsourceAdapter(ctx, config))
}
