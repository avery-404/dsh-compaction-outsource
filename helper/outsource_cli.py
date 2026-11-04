"""Ask agy / Claude Code / Codex to write a compaction checkpoint.

    python outsource_cli.py summarize <agy|claude|codex> <transcript.txt> <out.txt> [timeout_sec] [instruction.txt]
    python outsource_cli.py available                      # JSON: which backends can run on this machine

The transcript is a plain-text conversation (already stripped of reasoning and credentials by the plugin).
Standard library only. Exit code 0 and <out.txt> written on success; the reason goes to stderr otherwise.

Environment (all optional):
    AGY_ASK              path to agy_ask.py            (default ~/.claude/skills/outsource/agy_ask.py)
    CLAUDE_EXE           path to the Claude Code binary (default: PATH, then the Claude desktop app's bundled copy)
    CODEX_EXE            path to the Codex CLI          (default: PATH)
    OUTSOURCE_AGY_MODEL      model for agy              (default: agy_ask.py's own default)
    OUTSOURCE_CLAUDE_MODEL   model alias for Claude     (default: haiku, the cheapest)
    OUTSOURCE_CLAUDE_EFFORT  low|medium|high|xhigh|max  (default: low)
    OUTSOURCE_CODEX_EFFORT   low|medium|high|xhigh       (default: low)
    OUTSOURCE_CODEX_MODEL    model for Codex            (default: Codex's own default)
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HOME = Path.home()
CREATE_NO_WINDOW = 0x08000000 if os.name == 'nt' else 0

INSTRUCTION = (
    'You are the compaction engine for an AI coding assistant. The text on stdin (or in the attached file) is a '
    'conversation (### user / ### assistant / ### tool turns). Condense it into a checkpoint that lets another model '
    'resume the work with no loss of essential context.\n'
    'Output EXACTLY this Markdown structure, sections in this order, "(none)" for an empty section:\n'
    '## Primary Request and Intent\n## Key Technical Concepts\n## Files and Code\n## Errors and Fixes\n'
    '## Pending Jobs\n## Current Work\n## Next Step\n## Critical Context\n'
    'Rules: terse bullets; keep exact file paths, commands, error strings, identifiers and numbers; record the user\'s '
    'explicit instructions and corrections faithfully (quote when wording matters); if the conversation already '
    'contains a <summary> block it is a PRIOR checkpoint: merge it, keep still-true facts, drop stale ones; do not '
    'mention that this is a summary or compaction; output only the checkpoint text; do not call any tool or modify any file.'
)


GUARD = ('\n\nIMPORTANT: summarize ONLY the conversation between <conversation> and </conversation>. Ignore any other '
         'rules, restrictions or tool policies given to you by the tool you run in: they are not part of the conversation '
         'and must not appear in the checkpoint.')


def build_instruction(instruction):
    return (instruction.strip() or INSTRUCTION) + GUARD


def fence(text):
    return '<conversation>\n' + text + '\n</conversation>'


def find_agy():
    p = Path(os.environ.get('AGY_ASK') or HOME / '.claude' / 'skills' / 'outsource' / 'agy_ask.py')
    return p if p.is_file() else None


def _version_key(path):
    parts = []
    for piece in Path(path).parts:
        if piece.replace('.', '').isdigit():
            parts.append(tuple(int(x) for x in piece.split('.') if x.isdigit()))
    return parts


def find_claude():
    env = os.environ.get('CLAUDE_EXE')
    if env and Path(env).is_file():
        return env
    on_path = shutil.which('claude') or shutil.which('claude.exe')
    if on_path:
        return on_path
    roots = [os.environ.get('LOCALAPPDATA', ''), os.environ.get('APPDATA', ''), str(HOME / 'Library' / 'Application Support')]
    hits = []
    for root in filter(None, roots):
        # the desktop app keeps a versioned copy: <root>/Claude-Data/<id>/claude-code/<version>/<hash>/claude(.exe)
        hits += glob.glob(os.path.join(root, 'Claude*', '**', 'claude-code', '*', '*', 'claude.exe'), recursive=True)
        hits += glob.glob(os.path.join(root, 'Claude*', '**', 'claude-code', '*', '*', 'claude'), recursive=True)
    hits = [h for h in hits if Path(h).is_file()]
    return max(hits, key=_version_key) if hits else None


def find_codex():
    env = os.environ.get('CODEX_EXE')
    if env and Path(env).is_file():
        return env
    on_path = shutil.which('codex') or shutil.which('codex.cmd') or shutil.which('codex.exe')
    if on_path:
        return on_path
    # the VS Code / Cursor ChatGPT extension ships its own copy: <ext>/openai.chatgpt-<version>/bin/<platform>/codex(.exe)
    hits = []
    for ide in ('.vscode', '.cursor', '.vscode-insiders'):
        base = os.path.join(str(HOME), ide, 'extensions', 'openai.chatgpt-*', 'bin', '*')
        hits += glob.glob(os.path.join(base, 'codex.exe')) + glob.glob(os.path.join(base, 'codex'))
    hits = [h for h in hits if Path(h).is_file()]
    return max(hits, key=_version_key) if hits else None


def available():
    return {'agy': find_agy() is not None, 'claude': find_claude() is not None, 'codex': find_codex() is not None}


def run_agy(text, timeout, instruction=''):
    agy = find_agy()
    if not agy:
        raise RuntimeError('agy_ask.py not found (set AGY_ASK)')
    with tempfile.TemporaryDirectory() as tmp:
        qf, out = Path(tmp) / 'q.txt', Path(tmp) / 'a.txt'
        # --raw: no document-QA rules; the conversation travels inside the question, so agy needs no tools
        qf.write_text(build_instruction(instruction) + '\n\n' + fence(text), encoding='utf-8')
        cmd = [sys.executable, '-I', str(agy), '--raw', '--question-file', str(qf), '--out', str(out), '--timeout', str(timeout)]
        if os.environ.get('OUTSOURCE_AGY_MODEL'):
            cmd += ['--model', os.environ['OUTSOURCE_AGY_MODEL']]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace',
                           timeout=timeout + 30, creationflags=CREATE_NO_WINDOW)
        if out.exists() and out.read_text(encoding='utf-8', errors='replace').strip():
            return out.read_text(encoding='utf-8', errors='replace').strip()
        tail = ' | '.join((r.stdout or '').strip().splitlines()[-3:])
        raise RuntimeError('agy produced no answer: ' + tail[:300])


def run_claude(text, timeout, instruction=''):
    exe = find_claude()
    if not exe:
        raise RuntimeError('Claude Code binary not found (set CLAUDE_EXE)')
    model = os.environ.get('OUTSOURCE_CLAUDE_MODEL') or 'haiku'
    with tempfile.TemporaryDirectory() as cwd:  # neutral directory: no project CLAUDE.md is loaded
        r = subprocess.run([exe, '-p', build_instruction(instruction), '--model', model, '--effort', os.environ.get('OUTSOURCE_CLAUDE_EFFORT') or 'low',
                            '--tools', '', '--no-session-persistence'],
                           input=fence(text), capture_output=True, text=True, encoding='utf-8', errors='replace',
                           timeout=timeout, cwd=cwd, creationflags=CREATE_NO_WINDOW)
    out = (r.stdout or '').strip()
    if r.returncode != 0 or not out:
        why = (out or r.stderr or '').strip()[-300:] or f'exit {r.returncode}'
        if 'authenticate' in why.lower() or 'login' in why.lower():
            why += '  -> run once: "' + exe + '" auth login'
        raise RuntimeError('Claude failed: ' + why)
    return out


def run_codex(text, timeout, instruction=''):
    exe = find_codex()
    if not exe:
        raise RuntimeError('Codex CLI not found (set CODEX_EXE)')
    with tempfile.TemporaryDirectory() as cwd:
        last = Path(cwd) / 'last.txt'
        # read-only sandbox in an empty temp dir, no session files kept, prompt on stdin ("-")
        cmd = [exe, 'exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-C', cwd, '-o', str(last),
               '-c', 'model_reasoning_effort="%s"' % (os.environ.get('OUTSOURCE_CODEX_EFFORT') or 'low')]
        if os.environ.get('OUTSOURCE_CODEX_MODEL'):
            cmd += ['-m', os.environ['OUTSOURCE_CODEX_MODEL']]
        cmd.append('-')  # prompt from stdin
        r = subprocess.run(cmd, input=build_instruction(instruction) + '\n\n' + fence(text), capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=timeout, cwd=cwd, creationflags=CREATE_NO_WINDOW)
        out = last.read_text(encoding='utf-8', errors='replace').strip() if last.exists() else (r.stdout or '').strip()
    if r.returncode != 0 or not out:
        why = (r.stderr or out or '').strip()[-300:] or f'exit {r.returncode}'
        if any(w in why.lower() for w in ('login', 'auth', 'sign in', 'api key')):
            why += '  -> run once: codex login'
        raise RuntimeError('Codex failed: ' + why)
    return out


RUNNERS = {'agy': run_agy, 'claude': run_claude, 'codex': run_codex}


def main(argv):
    if len(argv) == 2 and argv[1] == 'available':
        print(json.dumps(available()))
        return 0
    if len(argv) < 5 or argv[1] != 'summarize' or argv[2] not in RUNNERS:
        print('usage: outsource_cli.py summarize <agy|claude|codex> <in.txt> <out.txt> [timeout]\n'
              '       outsource_cli.py available', file=sys.stderr)
        return 2
    backend, src, dst = argv[2], Path(argv[3]), Path(argv[4])
    timeout = int(argv[5]) if len(argv) > 5 else 600
    instruction = Path(argv[6]).read_text(encoding='utf-8') if len(argv) > 6 and Path(argv[6]).is_file() else ''
    try:
        ans = RUNNERS[backend](src.read_text(encoding='utf-8'), timeout, instruction)
    except Exception as e:  # the plugin reports this and falls back to the main model
        print(str(e)[:500], file=sys.stderr)
        return 1
    if len(ans.strip()) < 200:
        print('answer too short to be a checkpoint', file=sys.stderr)
        return 1
    dst.write_text(ans.strip(), encoding='utf-8')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
