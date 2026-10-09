// Index answers that read more than the requested scope: graph modes, MCP envelopes, and the
// scope key the index records.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { clearDbCache } from './search-db.js';
import { withIndex } from './search-output.js';

const makeProject = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-g6-held-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
};

const cleanup = (root) => {
  clearDbCache();
  fs.rmSync(root, { recursive: true, force: true });
};

const CLI = path.join(path.dirname(new URL(import.meta.url).pathname), 'index.js');
const runQ = (root, args) => {
  const res = spawnSync(process.execPath, ['--no-warnings', CLI, 'q', ...args, '--json'], { cwd: root, encoding: 'utf-8' });
  return { status: res.status, payload: JSON.parse(res.stdout.trim().split('\n').pop()) };
};

test('withIndex: a payload that says pass never hides an inconclusive index', () => {
  const merged = withIndex({ status: 'pass', count: 0 }, { status: 'inconclusive', reason: 'index busy' });
  assert.equal(merged.status, 'inconclusive');
});

test('MCP q graph modes report an inconclusive index (missing --dir), like the CLI', async () => {
  const root = makeProject({ 'src/a.js': 'export const useAlpha = () => 1;\n' });
  try {
    const { handleChemxQ } = await import('./mcp/tools-q.js');
    for (const mode of ['blastRadius', 'trace', 'backtrace', 'semantic']) {
      clearDbCache();
      const result = handleChemxQ({ query: 'useAlpha', dir: 'srcc', [mode]: true }, root);
      assert.equal(result.status, 'inconclusive', `${mode}: ${JSON.stringify(result).slice(0, 200)}`);
      assert.match(result.index.reason, /srcc/);
    }
  } finally {
    cleanup(root);
  }
});
