import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSearchArgs } from './search-args.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');

const runQ = (cwd, args) => new Promise((resolve) => {
  execFile(process.execPath, ['--no-warnings', CLI, 'q', ...args], { cwd, env: { ...process.env, NO_COLOR: '1', CHEMX_PROJECT_ROOT: '' } }, (err, stdout, stderr) => {
    resolve({ code: err ? err.code : 0, stdout, stderr });
  });
});

const parseJson = (res) => {
  try {
    return JSON.parse(res.stdout.trim().split('\n').pop());
  } catch (err) {
    throw new Error(`stdout is not JSON (exit ${res.code}): ${res.stdout.slice(0, 300)} ${res.stderr.slice(0, 300)} ${err.message}`);
  }
};

const longBody = Array.from({ length: 58 }, (_, i) => `  const v${i} = ${i};`).join('\n');
const FIXTURE = {
  'src/stores/index.ts': 'export const useCompassStore = () => ({ a: 1 });\n',
  'src/mechanics/useA.ts': "import { useCompassStore } from '../stores/index';\nexport const useA = () => useCompassStore();\n",
  'src/mechanics/useCompassStoreHelpers.ts': 'export const useCompassStoreHelpers = () => 1;\nexport const useCompassStoreExtra = () => 2;\n',
  'src/mechanics/useLong.ts': `export function useLong() {\n${longBody}\n}\n`,
  'src/styles/glass.scss': '.x { --x-glass: 1; }\n'
};

const makeFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-q-cli-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  for (const [rel, content] of Object.entries(FIXTURE)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
};

test('parseSearchArgs: flag values never become the query and -- ends options', () => {
  assert.deepEqual(parseSearchArgs(['-n', '5', 'useWindowStore']).positionals, ['useWindowStore']);
  assert.equal(parseSearchArgs(['-n', '5', 'useWindowStore']).values.limit, '5');
  assert.equal(parseSearchArgs(['-g', '--x-glass', '-n', '5']).pattern, '--x-glass');
  assert.deepEqual(parseSearchArgs(['-g', '--', '--x-glass']).positionals, ['--x-glass']);
  assert.deepEqual(parseSearchArgs(['--dir', 'apps', 'foo']).positionals, ['foo']);
  assert.deepEqual(parseSearchArgs(['foo', '--bogus']).unknownFlags, ['--bogus']);
});

test('chemx q: help, ranking, limits, argv, def cap, hazards and every mode are truthful', async () => {
  const root = makeFixture();
  try {
    const help = await runQ(root, ['--help']);
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /Query Machine/);

    const ranked = parseJson(await runQ(root, ['-n', '2', 'useCompassStore', '--json', '--raw-json']));
    assert.equal(ranked.query, 'useCompassStore');
    assert.equal(ranked.results[0].path, 'src/stores/index.ts', 'the definition ranks first');
    assert.equal(ranked.results[0].match.type, 'definition');
    assert.equal(ranked.count, 2);
    assert.equal(ranked.total, 3, 'definition + helper file + the hook call site in useA.ts');
    assert.equal(ranked.truncated, true);
    assert.equal(ranked.index.scope, 'src');

    const truncated = parseJson(await runQ(root, ['use', '-n', '1', '--json', '--raw-json']));
    assert.equal(truncated.truncated, true, 'a page smaller than the total says so');
    assert.ok(truncated.total > 1);

    const def = parseJson(await runQ(root, ['def', 'useLong', '--json']));
    assert.equal(def.truncated, true);
    assert.equal(def.shownLines, 40);
    const fullDef = parseJson(await runQ(root, ['def', 'useLong', '--full', '--json']));
    assert.equal(fullDef.truncated, false);
    assert.equal(fullDef.snippet.split('\n').length, fullDef.bodyLines);

    const hazards = await runQ(root, ['hazards', '--json']);
    assert.equal(hazards.code, 3, 'no audit data is inconclusive (exit 3)');
    assert.equal(parseJson(hazards).status, 'inconclusive');
    const hazardsText = await runQ(root, ['hazards']);
    assert.doesNotMatch(hazardsText.stdout, /healthy/i);

    const outside = await runQ(root, ['useA', '--dir', os.tmpdir(), '--json']);
    assert.equal(outside.code, 3, 'a scope outside the project root is inconclusive');

    const modes = [['useA', '--blast-radius', '--json'], ['useA', '--semantic', '--json'], ['useA', '--hybrid', '--json'],
      ['refs', 'useCompassStore', '--json'], ['deps', 'src/mechanics/useA.ts', '--json'], ['trace', 'useA', '--json'],
      ['backtrace', 'useCompassStore', '--json']];
    for (const args of modes) {
      const res = await runQ(root, args);
      assert.equal(res.code, 0, `q ${args.join(' ')} exited ${res.code}: ${res.stderr.slice(0, 300)}`);
      assert.ok(parseJson(res).index, `q ${args.join(' ')} reports its index scope`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('chemx q from a subdirectory syncs the project index instead of serving it stale', async () => {
  const root = makeFixture();
  try {
    await runQ(root, ['useA', '--json']);
    const subdir = path.join(root, 'src', 'mechanics');
    fs.writeFileSync(path.join(subdir, 'useQuokkaProbe.ts'), 'export const useQuokkaProbe = () => 2;\n');
    const res = parseJson(await runQ(subdir, ['useQuokkaProbe', '--json', '--raw-json']));
    assert.equal(res.count, 1);
    assert.equal(res.results[0].path, 'src/mechanics/useQuokkaProbe.ts');
    assert.equal(fs.existsSync(path.join(subdir, '.chemx')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
