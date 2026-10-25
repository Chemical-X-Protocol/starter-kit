/**
 * The generated agent protocol names every chemx command and every wait mode (#6776).
 * The command list comes from cli/commands-schema*.js and the wait modes from cli/wait-command.js, so a
 * command or mode added later fails here until the text names it (or EXCLUDED says why it does not).
 * Guaranteed: the host protocol block, GEMINI.md, the Antigravity rule, the tesseract briefing and the dispatch
 * WAITING line say what these sources say. Not guaranteed: that an agent reads them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS_SCHEMA, findCommandSchema } from './commands-schema.js';
import { WAIT_HELP, parseWaitArgs } from './wait-command.js';
import { buildProtocolBlock, buildProtocolHostFiles } from './host-protocol.js';
import { JARVIS_OPERATIONS } from './lattice-directives.js';
import { buildRunPlan } from './team/team-dispatch-v2.js';
import { renderTaskPrompts } from './team/team-dispatch-prompts.js';
import { makeFixtureDb, fixtureOptions } from './team/team-dispatch-v2-fixture.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readKit = (rel) => fs.readFileSync(path.join(KIT_ROOT, rel), 'utf8');

// Commands the protocol text deliberately does not name, one reason each. Anything else a schema entry
// declares must appear as `chemx <name>` (or one of its aliases) in every protocol text.
const EXCLUDED = [
  { command: 'trace', reason: 'code-graph read, reached through chemx q and chemx read --connections; not a coordination step' },
  { command: 'backtrace', reason: 'code-graph read, reached through chemx q and chemx read --connections; not a coordination step' },
  { command: 'check', reason: 'chemx patch and chemx write print the hazards they introduce, and chemx verify runs the audit' },
  { command: 'add', reason: 'Vue capsule generator; a host edits with chemx patch and chemx write' },
  { command: 'explode', reason: 'capsule refactor run by the owner, not part of the claim, lock and commit loop' },
  { command: 'generate', reason: 'capsule scaffolder run by the owner, not part of the claim, lock and commit loop' },
  { command: 'typecheck', reason: 'a stage of chemx verify, which the Finish step names' },
  { command: 'lint', reason: 'a stage of chemx verify, which the Finish step names' },
  { command: 'build', reason: 'a stage of chemx verify, which the Finish step names' },
  { command: 'audit', reason: 'a stage of chemx verify, which the Finish step names' },
  { command: 'trend', reason: 'score history for the owner; no task depends on it' },
  { command: 'badge', reason: 'writes a grade badge for the README; no task depends on it' },
  { command: 'docs', reason: 'documentation drift check run by the gate, not by an agent mid-task' },
  { command: 'diff', reason: 'read-only git wrapper; a host without the Claude Code guard may use plain git for reads' },
  { command: 'show', reason: 'read-only git wrapper; a host without the Claude Code guard may use plain git for reads' },
  { command: 'conflicts', reason: 'read-only git wrapper; a host without the Claude Code guard may use plain git for reads' },
  { command: 'log', reason: 'read-only git wrapper; a host without the Claude Code guard may use plain git for reads' },
  { command: 'pkg', reason: 'read-only file wrapper; a host may read package.json directly' },
  { command: 'json', reason: 'read-only file wrapper; a host may read a JSON file directly' },
  { command: 'batch', reason: 'a convenience for running several chemx commands in one process; no step needs it' },
  { command: 'mcp', reason: 'starts the MCP server for a client; a person registers it once' },
  { command: 'install-mcp', reason: 'registers chemx in a client once; a person runs it' },
  { command: 'project', reason: 'coordinator session for the orchestrator, not for an agent holding one task' },
  { command: 'init', reason: 'unpacks blueprints into a codebase once; a person runs it' },
  { command: 'create', reason: 'scaffolds a new app; a person runs it' },
  { command: 'ui', reason: 'starts the web dashboard for a person' },
  { command: 'tesseract', reason: 'prints the onboarding briefing that this protocol text already carries' },
  { command: 'patterns', reason: 'repeated-code report for the forge workflow, run by the owner' },
  { command: 'blueprint', reason: 'repeated-code planner for the forge workflow, run by the owner' },
  { command: 'heal', reason: 'applies a forge blueprint; run by the owner' },
  { command: 'report', reason: 'savings report for the owner; no task depends on it' },
  { command: 'hook', reason: 'installs and runs hooks and CI once; a person runs it' },
  { command: 'doctor', reason: 'install diagnosis for a person; chemx doctor --fix is the owner\'s job' },
  { command: 'friction', reason: 'a report the owner reads; agents file friction with chemx team task add (step Friction)' }
];

const isExcluded = (entry) => EXCLUDED.some(({ command }) => command === entry.name);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokensOf = (entry) => [entry.name, ...entry.aliases];
const namesCommand = (text, entry) => tokensOf(entry).some((token) => new RegExp(`\\bchemx ${escapeRegExp(token)}(?![\\w:-])`).test(text));

const hostTexts = () => ({ 'protocol block': buildProtocolBlock(), ...Object.fromEntries(Object.entries(buildProtocolHostFiles())) });

// Mode lines of WAIT_HELP: two spaces, the flag with its value placeholder, then "until ...". Modifiers (--timeout, --from) do not say "until".
const MODE_LINE = /^ {2}(--[a-z-]+)(=<[^>]*>)?\s+until /;
const waitModes = () => WAIT_HELP.split('\n').flatMap((line) => {
  const match = MODE_LINE.exec(line);
  return match ? [{ flag: match[1], hasValue: match[2] !== undefined }] : [];
});

// The text of every chemx wait statement in a corpus, so --task and the like are not matched anywhere else.
const waitStatements = (text) => text.split('\n').filter((line) => line.includes('chemx wait')).join('\n');

test('protocol coverage: every schema command not in EXCLUDED is named as `chemx <name>` in every protocol text', () => {
  for (const [label, text] of Object.entries(hostTexts())) {
    const missing = COMMANDS_SCHEMA.filter((entry) => !isExcluded(entry) && !namesCommand(text, entry)).map((entry) => entry.name);
    assert.deepEqual(missing, [], `${label} does not name: ${missing.join(', ')}. Name it in cli/host-protocol.js or add it to EXCLUDED with a reason.`);
  }
});

test('protocol coverage: EXCLUDED names real commands once each, gives a reason, and lists none the text now names', () => {
  const commands = EXCLUDED.map(({ command }) => command);
  assert.equal(new Set(commands).size, commands.length, 'no command is excluded twice');
  const text = buildProtocolBlock();
  for (const { command, reason } of EXCLUDED) {
    const entry = COMMANDS_SCHEMA.find((candidate) => candidate.name === command);
    assert.ok(entry, `${command} is a schema command name`);
    assert.ok(reason.length > 20, `${command} has a reason`);
    assert.equal(namesCommand(text, entry), false, `${command} is named in the protocol text: remove it from EXCLUDED`);
  }
});

test('protocol coverage: the wait modes come from wait-command.js and the wait schema entry agrees', () => {
  const modes = waitModes();
  assert.deepEqual(modes.map((mode) => mode.flag), ['--task', '--lock-free', '--verify-idle', '--job', '--post-matching']);
  for (const { flag, hasValue } of modes) {
    assert.equal(parseWaitArgs([hasValue ? `${flag}=1` : flag]).error, null, `${flag} is a mode parseWaitArgs accepts`);
  }
  const schemaModes = findCommandSchema('wait').flags.filter((entry) => /^Until /.test(entry.desc)).map((entry) => entry.flag.split('=')[0]);
  assert.deepEqual(schemaModes, modes.map((mode) => mode.flag));
});

test('protocol coverage: the host protocol texts name every wait mode on a chemx wait line', () => {
  for (const [label, text] of Object.entries(hostTexts())) {
    const statements = waitStatements(text);
    // A mode that takes a value is named with its placeholder (--job=<pid>), so an example such as --job=$! does not stand in for it.
    const missing = waitModes().map(({ flag, hasValue }) => `chemx wait ${flag}${hasValue ? '=<' : ''}`).filter((form) => !statements.includes(form));
    assert.deepEqual(missing, [], `${label} wait line lacks: ${missing.join(', ')}`);
  }
});

test('protocol coverage: the dispatch WAITING line names every wait mode in build, review and repair prompts', () => {
  const plan = buildRunPlan(makeFixtureDb(), fixtureOptions());
  const task = plan.tasks.find((entry) => entry.id === 3);
  for (const [stage, prompt] of Object.entries(renderTaskPrompts(task, plan))) {
    const waiting = prompt.split('\n').find((line) => line.startsWith('WAITING: '));
    assert.ok(waiting, `${stage} prompt has a WAITING line`);
    const missing = waitModes().map((mode) => mode.flag).filter((flag) => !waiting.includes(flag));
    assert.deepEqual(missing, [], `${stage} WAITING line lacks: ${missing.join(', ')}`);
  }
});

test('protocol coverage: the tesseract briefing names the wait modes and the workspace commands', () => {
  const briefing = JARVIS_OPERATIONS.map((operation) => operation.cmd).join('\n');
  const statements = waitStatements(briefing);
  const missingModes = waitModes().map((mode) => mode.flag).filter((flag) => !statements.includes(flag));
  assert.deepEqual(missingModes, []);
  const workspace = ['worktree', 'scratch', 'mutate', 'run', 'ci', 'changelog', 'commit'];
  const missing = workspace.filter((name) => !namesCommand(briefing, findCommandSchema(name)));
  assert.deepEqual(missing, []);
});

test('protocol coverage: the kit\'s own GEMINI.md, Antigravity rule, AGENTS.md block and .cursorrules block are what the generator writes', () => {
  for (const [rel, content] of Object.entries(buildProtocolHostFiles())) {
    assert.equal(readKit(rel), content, `${rel} is stale: run chemx pillars --protocol-only --write`);
  }
  const block = buildProtocolBlock();
  for (const rel of ['AGENTS.md', '.cursorrules']) {
    assert.ok(readKit(rel).includes(block), `${rel} protocol block is stale: run chemx pillars --protocol-only --write`);
  }
});
