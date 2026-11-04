/**
 * Plain-text transcript of a conversation for an outside summarizer: reasoning dropped, credentials masked.
 * @module dsh-compaction-outsource/transcript
 */

const TOOL_BLOCK_CHARS = 1500
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b(api[-_ ]?key|secret|token|password|passwd)(["']?\s*[:=]\s*["']?)[^\s"',;]{8,}/gi,
]


/** Strip anything that looks like a credential before the transcript leaves the machine. */
export function redact(text) {
  return SECRET_PATTERNS.reduce((out, re) => out.replace(re, (m, a, b) => (b === undefined ? '[redacted]' : `${a}${b}[redacted]`)), text)
}

function blockText(block) {
  if (typeof block === 'string') return block
  if (block === null || typeof block !== 'object') return ''
  if (block.type === 'text') return block.text ?? ''
  if (/think|reason/i.test(block.type ?? '')) return ''
  if (/image/i.test(block.type ?? '')) return '[image]'
  const raw = JSON.stringify(block)
  return `[${block.type ?? 'block'}] ${raw.length > TOOL_BLOCK_CHARS ? `${raw.slice(0, TOOL_BLOCK_CHARS)}…` : raw}`
}

/** Plain-text transcript of the messages to condense (reasoning dropped, credentials masked). */
export function messagesToText(messages) {
  const parts = []
  for (const message of messages) {
    const content = Array.isArray(message.content) ? message.content : [message.content]
    const text = content.map(blockText).filter((t) => t.length > 0).join('\n')
    if (text.length > 0) parts.push(`### ${message.role}\n${text}`)
  }
  return redact(parts.join('\n\n'))
}


/** Text of one message (blocks joined, reasoning dropped). */
export function messageText(message) {
  const content = Array.isArray(message.content) ? message.content : [message.content]
  return content.map(blockText).filter((t) => t.length > 0).join('\n')
}

/**
 * Split the engine's request into its own summarization directive (the final user message, which carries the
 * required `## ` section layout) and the conversation before it. The outside AI is given the engine's own
 * directive, so its checkpoint has exactly the structure a locally written one would have.
 * @param messages - the compaction request messages.
 * @returns `{ directive, conversation }`; `directive` is '' when the last message has no section layout.
 */
export function splitDirective(messages) {
  const last = messages[messages.length - 1]
  const text = last && last.role === 'user' ? messageText(last) : ''
  return /^## .+$/m.test(text)
    ? { directive: text, conversation: messages.slice(0, -1) }
    : { directive: '', conversation: messages }
}

/** The `## ` section titles, in order, that the directive requires. */
export function requiredHeadings(directive) {
  return [...directive.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1])
}

/**
 * Make an outside AI's answer look like a locally written checkpoint: drop a chatty preface before the first
 * required heading and unwrap a code fence around the whole answer.
 */
export function normalizeCheckpoint(text, headings) {
  let out = text.trim().replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, '$1').trim()
  if (headings.length > 0) {
    const at = out.indexOf(`## ${headings[0]}`)
    if (at > 0) out = out.slice(at)
  }
  return out
}

/**
 * Check that a checkpoint is usable in place of a locally written one.
 * @param text - the normalized checkpoint.
 * @param headings - required section titles in order (empty = only the size checks apply).
 * @param sourceChars - size of the conversation it condenses.
 * @returns `{ ok, problems }`.
 */
export function validateCheckpoint(text, headings, sourceChars) {
  const problems = []
  let from = 0
  for (const heading of headings) {
    const at = text.indexOf(`## ${heading}`, from)
    if (at < 0) problems.push(`missing or out-of-order section "${heading}"`)
    else from = at + heading.length
  }
  // A refusal that still happens to carry the section titles is rejected too (content filters of the outside AI).
  if (/(I can(?:no|')t (?:help|assist|comply)|I'm sorry, but|I am unable to)|無法協助|不能協助|抱歉.{0,10}無法/i.test(text.slice(0, 400))) {
    problems.push('looks like a refusal')
  }
  if (text.length < 200) problems.push('too short to be a checkpoint')
  if (sourceChars > 0 && text.length >= sourceChars) problems.push('not shorter than the conversation')
  return { ok: problems.length === 0, problems }
}
