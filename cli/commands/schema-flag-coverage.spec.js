/**
 * Guards #4504: every long flag a cmd-<name>.js handler names must be listed in that command's
 * schema entry, or the unknown-flag rejection (#2583) refuses a flag the handler really reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCommandSchema } from '../commands-schema.js';
import { knownLongFlags, acceptedLongFlags, PASSTHROUGH_COMMANDS, findUnknownFlag } from './unknown-flags.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const GLOBAL = new Set(['--help', '--version', '--project-root', '--root', '--as']);
const handlers = fs.readdirSync(dir).filter((f) => /^cmd-.+\.js$/.test(f) && !f.includes('.spec'));

test('handler flags are all listed in the schema entry', () => {
  const gaps = [];
  for (const file of handlers) {
    const entry = findCommandSchema(file.slice(4, -3));
    const isChecked = entry && !Object.hasOwn(PASSTHROUGH_COMMANDS, entry.name);
    if (!isChecked) continue;
    const known = acceptedLongFlags(entry);
    const used = fs.readFileSync(path.join(dir, file), 'utf8').match(/['"`](--[a-z][a-z0-9-]*)/g) ?? [];
    for (const raw of new Set(used.map((s) => s.slice(1)))) {
      const isListed = known.has(raw) || GLOBAL.has(raw);
      if (!isListed) gaps.push(`${entry.name} ${raw}`);
    }
  }
  assert.deepEqual(gaps, []);
});

// #4510: handlers outside cmd-*.js. Each checked command maps to the files that parse its flags.
// patch and write share patcher-cli.js, so a flag there must be listed on at least one of the two.
const cliDir = path.join(dir, '..');
const HANDLER_SOURCES = {
  search: ['search-args.js'],
  patch: ['patcher-cli.js'],
  write: ['patcher-cli.js']
};
// patcher-cli.js serves both commands; its flag reads are split per command so a flag listed on one
// schema entry cannot hide a gap on the other. Shared helpers (between the two blocks) are not scanned.
const sliceBetween = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to));
const patcherSource = (command, src) => command === 'patch'
  ? sliceBetween(src, 'const PATCH_HELP', 'const WRITE_HELP') + sliceBetween(src, 'const PATCH_FLAGS', 'const WRITE_FLAGS')
  : src.slice(src.indexOf('const WRITE_HELP'), src.indexOf('];', src.indexOf('const WRITE_HELP'))) + src.slice(src.indexOf('const WRITE_FLAGS'));
const scopedSource = (command, file, src) => (path.basename(file) === 'patcher-cli.js' ? patcherSource(command, src) : src);
// Flags a handler passes to git, not flags of the chemx command.
const GIT_ARGV = new Set(['--show-toplevel', '--porcelain', '--untracked-files', '--no-color', '--diff-filter', '--get-regexp']);

test('non-cmd handler flags (search, patch, write) are all listed in the schema entry (#4510)', () => {
  const gaps = [];
  for (const [command, files] of Object.entries(HANDLER_SOURCES)) {
    const entry = findCommandSchema(command);
    const known = acceptedLongFlags(entry);
    for (const file of files) {
      const src = scopedSource(command, file, fs.readFileSync(path.join(cliDir, file), 'utf8'));
      const used = new Set((src.match(/['"`](--[a-z][a-z0-9-]*)/g) ?? []).map((s) => s.slice(1)));
      for (const flag of used) {
        const isListed = known.has(flag) || GLOBAL.has(flag);
        if (!isListed) gaps.push(`${command} ${flag}`);
      }
    }
  }
  assert.deepEqual(gaps, []);
});

// Every checked command the router dispatches: the case block plus the modules it imports are scanned.
const routerSources = () => {
  const lines = fs.readFileSync(path.join(dir, 'cmd-router.js'), 'utf8').split('\n');
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const label = line.match(/^\s{4}case '([^']+)':\s*(\{)?\s*$/);
    if (label) {
      const startsNewBlock = !current || current.body.length > 0;
      if (startsNewBlock) { current = { labels: [], body: [] }; blocks.push(current); }
      current.labels.push(label[1]);
    } else if (current) {
      current.body.push(line);
    }
  }
  const map = new Map();
  for (const { labels, body } of blocks) {
    const text = body.join('\n');
    // patcher.js re-exports; the flag reads live in patcher-cli.js.
    const files = [...text.matchAll(/import\('(\.\.?\/[^']+\.js)'\)/g)].map((m) => path.resolve(dir, m[1].replace('patcher.js', 'patcher-cli.js')));
    for (const label of labels) map.set(label, { text, files });
  }
  return map;
};

// Known gaps found when the scan widened to every routed handler; each is a flag the handler reads
// that its schema entry does not list yet (tracked by the #4510 follow-up). A new gap is not added here silently:
// anything not in this set fails the test.
const KNOWN_GAPS = new Set([
  'conflicts --conflicts', 'trend --limit',
  'init --headless', 'init --yes', 'init --ci', 'init --non-interactive', 'init --no-interactive', 'init --framework', 'init --preset', 'init --write', 'init --install',
  'create --ci', 'create --non-interactive', 'create --no-interactive', 'create --preset', 'create --write',
  'hook --write', 'doctor --host', 'doctor --scope', 'doctor --kit', 'doctor --write-mcp', 'pillars --yes', 'pillars --force',
  'generate --headless', 'generate --yes', 'generate --ci', 'generate --non-interactive', 'generate --no-interactive', 'generate --preset', 'generate --write', 'generate --install',
  'badge --grade', 'badge --label', 'badge --report-url', 'badge --discussion', 'badge --format', 'badge --copy',
  'verify --allow-empty', 'verify --changed', 'verify --all-packages', 'verify --timeout', 'verify --profile', 'verify --base',
  'ui --dev', 'ui --allow-host', 'patterns --name'
]);

test('every checked command the router dispatches has its handler flags listed (#4510)', () => {
  const routes = routerSources();
  const gaps = [];
  const seen = new Set();
  for (const [label, { text, files }] of routes) {
    const entry = findCommandSchema(label);
    const isChecked = entry && !Object.hasOwn(PASSTHROUGH_COMMANDS, entry.name);
    const isSkipped = !isChecked || seen.has(entry.name);
    if (isSkipped) continue;
    seen.add(entry.name);
    const sources = [text, ...files.filter((f) => fs.existsSync(f)).map((f) => scopedSource(entry.name, f, fs.readFileSync(f, 'utf8')))];
    const known = acceptedLongFlags(entry);
    for (const src of sources) {
      for (const raw of new Set((src.match(/['"`](--[a-z][a-z0-9-]*)/g) ?? []).map((s) => s.slice(1)))) {
        const isKnownGap = KNOWN_GAPS.has(`${entry.name} ${raw}`);
        const isListed = known.has(raw) || GLOBAL.has(raw) || GIT_ARGV.has(raw) || isKnownGap;
        if (!isListed) gaps.push(`${entry.name} ${raw}`);
      }
    }
  }
  assert.deepEqual(gaps, []);
  assert.ok(seen.size > 20, `router mapping found only ${seen.size} checked commands`);
});

test('q -g takes a dash-prefixed pattern and the real q flags are accepted (#4510)', () => {
  assert.equal(findUnknownFlag('q', ['q', '-g', '--x-glass', '-n', '5', '--json']), null);
  assert.equal(findUnknownFlag('q', ['q', 'x', '--raw-json']), null);
  assert.equal(findUnknownFlag('patch', ['patch', 'a.js', '--allow-remove=a,b']), null);
  assert.match(findUnknownFlag('q', ['q', '-g', '--json', '--bogus']) ?? '', /--bogus/);
});

test('check accepts --profile, --json and --compact', () => {
  assert.equal(findUnknownFlag('check', ['check', 'a.vue', '--profile=atomic-strict', '--json', '--compact']), null);
  assert.equal(findUnknownFlag('check', ['check', 'a.vue', '--profile', 'atomic-strict']), null);
});

test('test help lists the lane flags the docs name (#4509)', () => {
  const listed = findCommandSchema('test').flags.map((f) => f.flag.split(/[=\s]/)[0]);
  for (const flag of ['--slow', '--all', '--changed', '--base', '--related', '--depth', '--profile', '--top']) {
    assert.ok(listed.includes(flag), `test help omits ${flag}`);
  }
});

test('team task help lists every task-level flag team-flags.js parses (#4509)', async () => {
  const { formatTaskHelpCard } = await import('../team/team-format.js');
  const card = formatTaskHelpCard().replace(/\x1b\[[0-9;]*m/g, '');
  const src = fs.readFileSync(path.join(dir, '../team/team-flags.js'), 'utf8');
  const parsed = new Set((src.match(/'(--[a-z][a-z0-9-]*)/g) ?? []).map((s) => s.slice(1)));
  // Flags parsed for other team subcommands, documented on their own help cards.
  const ELSEWHERE = new Set([
    '--type', '--task', '--rule', '--tier', '--purpose', '--run', '--workflow', '--compact', '--mark-read',
    '--to', '--since', '--max-agents', '--per-agent', '--max-tasks-per-agent', '--thread', '--pid', '--tokens',
    '--prompt-tokens', '--completion-tokens', '--cached-tokens', '--cost', '--model', '--log', '--metadata',
  ]);
  const missing = [...parsed].filter((f) => !ELSEWHERE.has(f) && !card.includes(f));
  assert.deepEqual(missing, []);
});

test('team task help lists close and the flags its handlers read (#4509)', async () => {
  const { formatTaskHelpCard } = await import('../team/team-format.js');
  const card = formatTaskHelpCard().replace(/\x1b\[[0-9;]*m/g, '');
  for (const word of ['close', '--parent', '--desc', '--repo', '--all-repos', '--duplicate-of', '--cancel']) {
    assert.ok(card.includes(word), `team task help omits ${word}`);
  }
});
