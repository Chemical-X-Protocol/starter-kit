import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateAstOutline } from './reader.js';
import { handleLiteralSearchCommand } from './search-commands.js';
import { runPkg, runFiles } from './commands/cmd-wrappers.js';
import { openIndexDb, upsertFileIndex, queryIndexPage } from './search-db.js';
import { syncSearchIndex } from './search.js';

test('Fix 1: Index isolation excludes cli/ from project search by default', () => {
  const cwd = process.cwd();
  const db = openIndexDb(cwd);
  assert.ok(db, 'Index DB should open');

  const syncRes = syncSearchIndex('src', cwd, { reindex: false, includeInternal: false });
  assert.ok(syncRes, 'Sync should complete');

  // The index may hold cli/ rows from an earlier --include-internal or --dir . sync; a default
  // (src) answer must never serve them.
  const listing = queryIndexPage(db, { query: '', scopeDirs: syncRes.scopeDirs, limit: 100000 });
  const cliFiles = listing.results.filter((r) => r.path.startsWith('cli/'));
  assert.equal(cliFiles.length, 0, 'Project answers must not contain internal cli/ files');
});

test('Fix 2: Literal search matches exact strings with line numbers and full lines', () => {
  const cwd = process.cwd();
  const db = openIndexDb(cwd);

  const res = handleLiteralSearchCommand(db, 'import', {
    isCaseInsensitive: false,
    isLineOnly: false,
    limit: 5,
    isJson: true,
    isCli: false,
    cwd
  });

  assert.ok(res.matches.length > 0, 'Literal search should find matches');
  assert.ok(res.matches.length <= 5, 'Should respect limit');
  const first = res.matches[0];
  assert.ok(first.path, 'Match should have path');
  assert.ok(typeof first.line === 'number', 'Match should have line number');
  assert.equal(typeof first.text, 'string', 'Match carries the full matched line');
  assert.ok(first.text.includes('import'), 'The line contains the literal pattern');
});

test('Fix 3: Literal search supports line-only mode (-l)', () => {
  const cwd = process.cwd();
  const db = openIndexDb(cwd);

  const res = handleLiteralSearchCommand(db, 'import', {
    isCaseInsensitive: false,
    isLineOnly: true,
    limit: 5,
    isJson: true,
    isCli: false,
    cwd
  });

  assert.ok(res.matches.length > 0, 'Should find matches in line-only mode');
  const first = res.matches[0];
  assert.ok(first.path, 'Match should have path');
  assert.ok(first.line, 'Match should have line');
  assert.equal(first.text, undefined, 'Line text must be omitted in line-only mode');
});

test('Fix 4: Vue SFC outline detects template-only components', () => {
  const templateOnlyVue = `<template>\n  <div class="test">\n    <h1>Hello</h1>\n  </div>\n</template>\n`;
  const outline = generateAstOutline(templateOnlyVue, 'app/components/TestEmpty.vue');

  assert.match(outline, /\/\/ Template-only component \(no <script> block detected\)/);
});

test('Fix 5: Outline explicitly reports omitted unexported functions', () => {
  const codeWithHelpers = `
export function publicApi() {
  return helperOne();
}

function helperOne() {
  return 1;
}

const helperTwo = () => {
  return [1, 2, 3].map((x) => x * 2);
};
`;
  const outline = generateAstOutline(codeWithHelpers, 'src/api/service.ts');

  assert.match(outline, /export function publicApi/);
  assert.match(outline, /\/\/ \[Notice: \d+ internal\/unexported function\(s\) omitted\. Use chemx read --symbol=<name> to inspect\]/);
});

test('Fix 6: Vue SFC outline detects companion controller if present', () => {
  const tmpDir = path.join(process.cwd(), 'scratch', 'test-companion');
  fs.mkdirSync(tmpDir, { recursive: true });

  const vuePath = path.join(tmpDir, 'MyCard.vue');
  const controllerPath = path.join(tmpDir, 'MyCard.controller.ts');

  fs.writeFileSync(vuePath, '<template><div>Card</div></template>');
  fs.writeFileSync(controllerPath, 'export function useMyCard() { return {}; }');

  const outline = generateAstOutline('<template><div>Card</div></template>', vuePath);

  assert.match(outline, /\/\/ Companion controller detected: .*MyCard\.controller\.ts/);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Fix 7: Package inspector cx p extracts scripts without full file dump', async () => {
  const res = await runPkg(['p', 'test'], false);
  assert.equal(res.code, 0);
  assert.match(res.output, /node --test/);

  const scriptListRes = await runPkg(['p', '-s'], false);
  assert.equal(scriptListRes.code, 0);
  assert.match(scriptListRes.output, /test: node --test/);
});

test('Fix 8: File finder cx f respects ignore rules', async () => {
  const res = await runFiles(['f'], false);
  assert.equal(res.code, 0);
  assert.ok(!res.output.includes('node_modules/'), 'Files list must never include node_modules');
  assert.ok(!res.output.includes('.chemx/'), 'Files list must not include .chemx internal dir');
});

test('Fix 9: JSON peeker cx j summarises large files as shape with scalar values', async () => {
  const { runJsonShape } = await import('./commands/cmd-wrappers.js');
  const res = await runJsonShape(['j', 'package.json'], false);
  assert.equal(res.code, 0);
  assert.match(res.output, /\/\/ JSON: package\.json \(\d+ bytes.*shape with values/);
  assert.match(res.output, /name: "/);
  assert.match(res.output, /scripts: {/);
});

test('Fix 10: Batch command runner cx do runs multiple commands sequentially', async () => {
  const { runBatch } = await import('./commands/cmd-wrappers.js');
  let executed = [];
  const dummyDispatch = async (cmd, args) => {
    executed.push(cmd);
  };
  const res = await runBatch(['do', 'p -s', 'f'], false, dummyDispatch);
  assert.equal(res.code, 0);
  assert.deepEqual(executed, ['p', 'f']);
});
