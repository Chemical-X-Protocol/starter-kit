import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncSingleFileIndex } from './search.js';
import { openIndexDb, queryIndex } from './search-db.js';
import { handleChemxPatch, handleChemxWrite, handleChemxRead, handleChemxQ } from './mcp/tools-search.js';

test('bulletproof: syncSingleFileIndex updates index.db and generates embeddings', () => {
  const cwd = process.cwd();
  const testFile = path.resolve(cwd, 'scratch/test-bulletproof-target.ts');
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(testFile, 'export const bulletproofHelper = (val: string): boolean => val.length > 0;\n', 'utf-8');

  // Warmup connection
  syncSingleFileIndex(testFile, cwd);

  const start = performance.now();
  const res = syncSingleFileIndex(testFile, cwd);
  const duration = performance.now() - start;

  assert.ok(res, 'Should return index result');
  assert.equal(res.status, 'indexed');
  assert.ok(duration < 1500, 'Expected single file sync and embedding generation to complete reasonably fast');

  const db = openIndexDb(cwd);
  const row = db.prepare('SELECT * FROM symbols WHERE name = ?').get('bulletproofHelper');
  assert.ok(row, 'Should find newly indexed symbol');

  // Cleanup
  fs.unlinkSync(testFile);
  syncSingleFileIndex(testFile, cwd);
});

test('bulletproof: handleChemxWrite and handleChemxPatch auto-sync index', () => {
  const cwd = process.cwd();
  const testFile = path.resolve(cwd, 'scratch/test-auto-sync.ts');
  fs.mkdirSync(path.dirname(testFile), { recursive: true });

  // Write new file via MCP
  handleChemxWrite({
    path: 'scratch/test-auto-sync.ts',
    content: 'export const autoSyncInitial = () => 42;\n'
  }, cwd);

  const db = openIndexDb(cwd);
  const sym1 = db.prepare('SELECT * FROM symbols WHERE name = ?').get('autoSyncInitial');
  assert.ok(sym1, 'handleChemxWrite should auto-sync symbol into database');

  // Patch file via MCP
  handleChemxPatch({
    path: 'scratch/test-auto-sync.ts',
    targetContent: 'autoSyncInitial',
    replacementContent: 'autoSyncPatched'
  }, cwd);

  const sym2 = db.prepare('SELECT * FROM symbols WHERE name = ?').get('autoSyncPatched');
  assert.ok(sym2, 'handleChemxPatch should auto-sync patched symbol into database');

  // Cleanup
  fs.unlinkSync(testFile);
  syncSingleFileIndex(testFile, cwd);
});

test('bulletproof: queryIndex and handleChemxQ fallback to FTS5 on symbol misses', () => {
  const cwd = process.cwd();
  const testFile = path.resolve(cwd, 'scratch/test-fts-target.ts');
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(testFile, 'const secretUnexportedToken = "xyz123";\n', 'utf-8');
  syncSingleFileIndex(testFile, cwd);

  const db = openIndexDb(cwd);
  const results = queryIndex(db, { query: 'test-fts-target' });
  assert.ok(results.length > 0, 'queryIndex should find file containing token via FTS');

  const mcpRes = handleChemxQ({ query: 'test-fts-target' }, cwd);
  assert.ok(typeof mcpRes === 'string', 'Should return formatted text');
  assert.ok(mcpRes.includes('test-fts-target'), 'handleChemxQ should match file');

  // Cleanup
  fs.unlinkSync(testFile);
  syncSingleFileIndex(testFile, cwd);
});

test('bulletproof: handleChemxRead wraps in language-fenced markdown and adds context envelope', () => {
  const cwd = process.cwd();
  const testFile = path.resolve(cwd, 'scratch/test-read-envelope.ts');
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(testFile, 'import { openIndexDb } from "./cli/search-schema.js";\nexport const testReadSym = () => 1;\n', 'utf-8');
  syncSingleFileIndex(testFile, cwd);

  const res = handleChemxRead({
    path: 'scratch/test-read-envelope.ts',
    symbol: 'testReadSym'
  }, cwd);

  assert.ok(typeof res === 'string');
  assert.ok(res.includes('typescript'), 'Should contain language fence');
  assert.ok(res.includes('export const testReadSym'), 'Should contain function declaration');

  // Cleanup
  fs.unlinkSync(testFile);
  syncSingleFileIndex(testFile, cwd);
});
