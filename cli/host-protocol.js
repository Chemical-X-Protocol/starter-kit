/**
 * Host protocol rules: the shared-workspace protocol (identity, claim, status, lock, edit,
 * test, commit, wait, inbox, handoff, friction) as plain rules for agent hosts that cannot
 * run Claude Code hooks (Antigravity, Cursor, Gemini, Codex).
 *
 * One source: PROTOCOL_STEPS below. Every host file is rendered from it, so they cannot drift.
 * Guaranteed: the text is generated and pinned by a spec. Not guaranteed: a host that ignores
 * its rules file is not stopped, because only Claude Code hooks can block a call.
 */

import fs from 'node:fs';
import path from 'node:path';
import { GENERATED_MARKERS } from './pillars-write-guard.js';

export const PROTOCOL_BEGIN = '<!-- chemx:protocol begin -->';
export const PROTOCOL_END = '<!-- chemx:protocol end -->';
export const PROTOCOL_HOST_FILES = ['GEMINI.md', '.agent/rules/chemx-protocol.md'];

const PROTOCOL_STEPS = [
  ['Identity', 'Pass `--as=@<your session name>` on every `chemx team` command, or set `CHEMX_AGENT_ID`. Never act as the default `@agent`.'],
  ['Before choosing work', 'Run `chemx status`, `chemx team status`, `chemx team inbox @<you>` and `chemx team task list --status=in_progress` so you know what is claimed and locked.'],
  ['Claim', 'Find or create the task (`chemx team task add "<title>" --needs=light|standard|deep`), then run `chemx team task claim <id> --as=@<you>`.'],
  ['Lock before edit', 'Run `chemx team lock acquire <file> --as=@<you> --purpose="#<id>"` before the first edit of each file. If another handle holds the lock, do not edit that file: send `chemx team dm @<handle> "<msg>" --as=@<you>` or pick other work.'],
  ['Edit through chemx', 'Read with `chemx read <path> --outline` or `--symbol=<name>`, search with `chemx q` or `chemx q -g "<text>"`, find files with `chemx f`, and edit with `chemx patch` or `chemx write`. Avoid cat, sed, grep and direct file writes where chemx has an equivalent.'],
  ['Test', 'Run targeted specs with `chemx test <spec files> [-t name]`. Run a full suite only after parallel editors have finished.'],
  ['Commit', 'Run `chemx commit <files> -m "<type>(<area>): <summary> (#<id>)"`. It stages and commits only the listed files, runs the repository pre-commit hook and refuses a file under another handle\'s lease. Do not use `git add -A`, `git commit -a`, `git stash`, git worktrees or side branches.'],
  ['Wait', 'Use `chemx wait --task=<id>`, `chemx wait --lock-free=<file>` or `chemx wait --verify-idle` instead of sleep loops. The result is true as of the last poll only.'],
  ['Progress', 'Record progress with `chemx team task comment <id> "<msg>" --as=@<you>` and decisions with `chemx team post "<msg>" --type=decision --task=<id> --as=@<you>`.'],
  ['Inbox', 'Run `chemx team inbox @<you>` at every task boundary: after claiming, after committing, and before starting the next task.'],
  ['Handoff', 'To pass a task to another agent, run `chemx team task handoff <id> @<to> --as=@<you>`. Only the assignee or creator can hand off.'],
  ['Finish', 'Run the package gate (`chemx verify`), commit, release every lock with `chemx team lock release <file> --as=@<you>`, then run `chemx team task done <id> --target=<file> --as=@<you>`. If the gate refuses, mark the task blocked with a reason. Do not use `--force`.'],
  ['Friction', 'When a chemx command misbehaves, you bypass it, or a flag is missing, file `chemx team task add "Friction: <what happened>" --needs=light --desc="<exact command and output>"` and keep going.']
];

const PROTOCOL_INTRO = 'Shared-workspace protocol. Several agents edit this checkout at once, and chemx records claims, locks and messages in its team database. This host cannot run Claude Code hooks, so nothing blocks you: following these steps is up to you.';

const protocolLines = () => [
  PROTOCOL_INTRO,
  '',
  ...PROTOCOL_STEPS.map(([name, text], i) => `${i + 1}. ${name}: ${text}`)
];

export const buildProtocolBlock = () => [
  PROTOCOL_BEGIN,
  '## Chemical X coordination protocol (generated)',
  '',
  ...protocolLines(),
  '',
  'Regenerate with `chemx pillars --protocol --write`; edits inside this block are overwritten.',
  PROTOCOL_END
].join('\n') + '\n';

const hostFile = (title) => [
  GENERATED_MARKERS.md,
  `# ${title}: Chemical X protocol`,
  '',
  'AGENTS.md is the canonical rulebook for architecture. This generated file carries the coordination protocol only. Regenerate with `chemx pillars --protocol --write` instead of editing it.',
  '',
  ...protocolLines()
].join('\n') + '\n';

export const buildProtocolHostFiles = () => ({
  'GEMINI.md': hostFile('Gemini'),
  '.agent/rules/chemx-protocol.md': hostFile('Antigravity')
});

const hasBlock = (text) => text.includes(PROTOCOL_BEGIN) && text.includes(PROTOCOL_END);

const replaceBlock = (text, block) => {
  const start = text.indexOf(PROTOCOL_BEGIN);
  const end = text.indexOf(PROTOCOL_END) + PROTOCOL_END.length;
  const tail = text.slice(end).replace(/^\n/, '');
  return text.slice(0, start) + block + tail;
};

/** Insert the block into AGENTS.md text, or replace the existing block. Text outside the markers is untouched. */
export const upsertProtocolBlock = (text) => {
  const block = buildProtocolBlock();
  if (hasBlock(text)) return replaceBlock(text, block);
  const separator = text.endsWith('\n') ? '\n' : '\n\n';
  return text + separator + block;
};

const readIfPresent = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null);

// AGENTS.md keeps all its own text; only the marked block changes. A missing AGENTS.md is seeded from the template first.
const agentsTarget = (cwd, agentsTemplate) => {
  const file = path.resolve(cwd, 'AGENTS.md');
  const base = readIfPresent(file) ?? readIfPresent(agentsTemplate);
  const hasBase = base !== null;
  return hasBase ? [{ file, content: upsertProtocolBlock(base), isGuarded: false }] : [];
};

const cursorTarget = (cwd) => {
  const file = path.resolve(cwd, '.cursorrules');
  const base = readIfPresent(file) ?? GENERATED_MARKERS.rules + '\n';
  return { file, content: upsertProtocolBlock(base), isGuarded: false };
};

/**
 * Write targets for the protocol. Host files are guarded (a hand-written GEMINI.md is refused
 * without --force). AGENTS.md and .cursorrules are edited in place between the markers only.
 * Pass includeCursor false when the caller already builds .cursorrules from the shim.
 */
export const protocolTargets = (cwd, { agentsTemplate, includeCursor = true }) => [
  ...Object.entries(buildProtocolHostFiles()).map(([rel, content]) => ({ file: path.resolve(cwd, rel), content, isGuarded: true })),
  ...agentsTarget(cwd, agentsTemplate),
  ...(includeCursor ? [cursorTarget(cwd)] : [])
];
