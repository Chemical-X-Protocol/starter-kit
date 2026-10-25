import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');

const runQ = (cwd, args) => new Promise((resolve) => {
  execFile(process.execPath, ['--no-warnings', CLI, 'q', ...args], { cwd, env: { ...process.env, NO_COLOR: '1', CHEMX_PROJECT_ROOT: '', CHEMX_LITERAL_ENGINE: 'js' } }, (err, stdout, stderr) => {
    resolve({ code: err ? err.code : 0, stdout, stderr });
  });
});

const parseJson = (res) => JSON.parse(res.stdout.trim().split('\n').pop());

const FIXTURE = {
  'src/stores/index.ts': 'export const useCompassStore = () => ({ a: 1 });\n',
  'src/mechanics/useA.ts': "import { useCompassStore } from '../stores/index';\nexport const useA = () => useCompassStore();\n",
  'src/styles/a.scss': '.x { color: var(--gs-blue); border: var(--gs-edge-1) var(--gs-blue); }\n.y { --gs-red: 1; }\n',
  'src/styles/b.scss': 'a { color: var(--gs-green) }\n',
  'docs/note.md': 'alpha|beta live here\n'
};

const makeFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-q-modes-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  for (const [rel, content] of Object.entries(FIXTURE)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
};

const withFixture = async (body) => {
  const root = makeFixture();
  try {
    await body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const lines = (res) => res.stdout.split('\n').filter(Boolean);

test('q -g -l prints each matching file once and nothing else; --lines keeps path:line', () => withFixture(async (root) => {
  const files = await runQ(root, ['-g', '--gs-', '-l']);
  assert.deepEqual(lines(files), ['src/styles/a.scss', 'src/styles/b.scss']);
  const rows = await runQ(root, ['-g', '--gs-', '--lines']);
  assert.deepEqual(lines(rows), ['src/styles/a.scss:1', 'src/styles/a.scss:2', 'src/styles/b.scss:1']);
  const none = await runQ(root, ['-g', 'zzNoSuchTokenzz', '-l']);
  assert.equal(none.stdout, '');
  assert.match(none.stderr, /no matches/);
  const json = parseJson(await runQ(root, ['-g', '--gs-', '-l', '--json']));
  assert.deepEqual(json.files, ['src/styles/a.scss', 'src/styles/b.scss']);
  assert.equal(json.filesMatched, 2);
}));

test('q -g -l with -n cuts the file list and says so on stderr', () => withFixture(async (root) => {
  const res = await runQ(root, ['-g', '--gs-', '-l', '-n', '1']);
  assert.deepEqual(lines(res), ['src/styles/a.scss']);
  assert.match(res.stderr, /showing 1 of 2 files/);
}));

test('q -g -o prints the matched text with its location; --unique lists each distinct text once, sorted', () => withFixture(async (root) => {
  const only = await runQ(root, ['-g', '--gs-[a-z0-9-]+', '--regex', '-o']);
  assert.deepEqual(lines(only), [
    'src/styles/a.scss:1:--gs-blue', 'src/styles/a.scss:1:--gs-edge-1', 'src/styles/a.scss:1:--gs-blue',
    'src/styles/a.scss:2:--gs-red', 'src/styles/b.scss:1:--gs-green'
  ]);
  const unique = await runQ(root, ['-g', '--gs-[a-z0-9-]+', '--regex', '-o', '--unique']);
  assert.deepEqual(lines(unique), ['--gs-blue', '--gs-edge-1', '--gs-green', '--gs-red']);
  const impliedO = await runQ(root, ['-g', '--gs-[a-z0-9-]+', '--regex', '--only-matching', '--unique']);
  assert.deepEqual(lines(impliedO), lines(unique));
  const alone = await runQ(root, ['-g', '--gs-[a-z0-9-]+', '--regex', '--unique']);
  assert.deepEqual(lines(alone), lines(unique), '--unique alone implies -o');
}));

test('q -g -o --json carries parts per line and the distinct list', () => withFixture(async (root) => {
  const payload = parseJson(await runQ(root, ['-g', '--gs-[a-z0-9-]+', '--regex', '-o', '--unique', '--json']));
  assert.deepEqual(payload.distinct, ['--gs-blue', '--gs-edge-1', '--gs-green', '--gs-red']);
  const withLines = parseJson(await runQ(root, ['-g', '--gs-[a-z0-9-]+', '--regex', '-o', '--json']));
  assert.deepEqual(withLines.matches[0].parts, ['--gs-blue', '--gs-edge-1', '--gs-blue']);
  assert.equal(withLines.matches[0].text, undefined, '-o drops the whole line');
}));

test('q -g header says fixed string, and a regex-shaped pattern that finds nothing says how to use --regex', () => withFixture(async (root) => {
  const found = await runQ(root, ['-g', '--gs-blue']);
  assert.match(found.stdout, /Literal search "--gs-blue" \(fixed string\): 1 match in 1 files/);
  const miss = await runQ(root, ['-g', 'gamma|delta']);
  assert.match(miss.stdout, /0 matches/);
  assert.match(miss.stdout, /fixed string[^\n]*--regex/);
  const escaped = await runQ(root, ['-g', 'gamma\\|delta']);
  assert.match(escaped.stdout, /--regex/);
  const hit = await runQ(root, ['-g', 'alpha|beta', '--regex']);
  assert.match(hit.stdout, /\(regex\): 1 match in 1 files/);
  const plain = await runQ(root, ['-g', 'zzNoSuchTokenzz']);
  assert.doesNotMatch(plain.stdout, /--regex/, 'a plain word gets no regex hint');
  const json = parseJson(await runQ(root, ['-g', 'gamma|delta', '--json']));
  assert.match(json.hint, /--regex/);
}));

test('q -g --regex refuses lookahead and backreferences with a failing exit and the reason', () => withFixture(async (root) => {
  const res = await runQ(root, ['-g', 'a(?=b)', '--regex']);
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /lookaround[^\n]*not supported in regex mode/);
  const json = parseJson(await runQ(root, ['-g', '(a)\\1', '--regex', '--json']));
  assert.equal(json.status, 'fail');
  assert.match(json.error, /backreference/);
}));

test('q <text> with no symbol hit runs the fixed-string search in the same call under a label', () => withFixture(async (root) => {
  const res = await runQ(root, ['gs-blue']);
  assert.match(res.stdout, /no symbols; fixed-string matches: 1 match in 1 files/);
  assert.match(res.stdout, /src\/styles\/a\.scss:1:\.x \{ color: var\(--gs-blue\)/);
  assert.doesNotMatch(res.stdout, /Try literal search/, 'the old hint is gone');
  const symbol = await runQ(root, ['useA']);
  assert.doesNotMatch(symbol.stdout, /fixed-string matches/, 'a symbol hit never runs the fallback');
  const nothing = await runQ(root, ['zzNoSuchTokenzz']);
  assert.match(nothing.stdout, /no symbols; fixed-string matches: 0 matches in 0 files/);
}));

test('q <text> fallback in json carries the literal answer; --tier skips it', () => withFixture(async (root) => {
  const payload = parseJson(await runQ(root, ['gs-blue', '--json']));
  assert.equal(payload.total, 0);
  assert.equal(payload.literal.mode, 'fixed');
  assert.equal(payload.literal.totalMatches, 1);
  assert.equal(payload.literal.matches[0].path, 'src/styles/a.scss');
  const tiered = await runQ(root, ['gs-blue', '--tier=atom']);
  assert.doesNotMatch(tiered.stdout, /fixed-string matches/);
}));

test('q <text> <path>... scopes the symbol answer and the fallback to those files or directories', () => withFixture(async (root) => {
  const all = parseJson(await runQ(root, ['useCompassStore', '--json', '--raw-json']));
  assert.ok(all.results.some((r) => r.path === 'src/stores/index.ts'));
  const scoped = parseJson(await runQ(root, ['useCompassStore', 'src/mechanics', '--json', '--raw-json']));
  assert.deepEqual(scoped.results.map((r) => r.path), ['src/mechanics/useA.ts']);
  const fileScoped = parseJson(await runQ(root, ['useCompassStore', 'src/stores/index.ts', '--json', '--raw-json']));
  assert.deepEqual(fileScoped.results.map((r) => r.path), ['src/stores/index.ts']);
  const fallback = await runQ(root, ['gs-blue', 'src/styles/b.scss']);
  assert.match(fallback.stdout, /fixed-string matches: 0 matches in 0 files/);
  const wide = await runQ(root, ['gs-green', 'src/styles']);
  assert.match(wide.stdout, /src\/styles\/b\.scss:1:/);
}));

test('q <text> <missing path> fails naming the path and how to quote a phrase', () => withFixture(async (root) => {
  const res = await runQ(root, ['useA', 'extra']);
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /path not found: extra/);
  assert.match(res.stderr, /quote/);
}));
