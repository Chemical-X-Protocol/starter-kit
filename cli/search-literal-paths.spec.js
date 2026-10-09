import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleLiteralSearchCommand } from './search-commands.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SYMBOL = 'handleLiteralSearchCommand';

const search = (dir) => handleLiteralSearchCommand(null, SYMBOL, { isCli: false, isQuiet: true, cwd: KIT_ROOT, dir, limit: 500 });

test('q -g path: a directory scopes the search to that directory', () => {
  const res = search('cli/mcp');
  assert.ok(res.matches.length > 0);
  assert.ok(res.matches.every((m) => m.path.startsWith('cli/mcp/')));
});

test('q -g path: a file scopes the search to that file', () => {
  const res = search('cli/mcp/tools-q.js');
  assert.ok(res.matches.length > 0);
  assert.ok(res.matches.every((m) => m.path === 'cli/mcp/tools-q.js'));
});

test('q -g path: several paths are all searched and nothing else', () => {
  const res = search(['cli/mcp/tools-q.js', 'cli/search.js']);
  const paths = new Set(res.matches.map((m) => m.path));
  assert.deepEqual([...paths].sort(), ['cli/mcp/tools-q.js', 'cli/search.js']);
});

test('q -g path: a nonexistent path is an error naming it, not a full scan', () => {
  const res = search('cli/no-such-dir');
  assert.equal(res.status, 'fail');
  assert.match(res.error, /cli\/no-such-dir/);
  assert.equal(res.matches.length, 0);
});

test('q -g path: no path still searches the whole project', () => {
  const res = search(null);
  const tops = new Set(res.matches.map((m) => m.path.split('/')[0]));
  assert.ok(res.filesSearched > 100);
  assert.ok(tops.has('cli'));
});
