// #5919: a large index sync writes its rows in short transactions instead of holding the shared
// write lock (the root db carries every team write) for the whole sync.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { upsertFileIndexBatch } from './search-index-write.js';
import { commitSyncPlan } from './search-sync-plan.js';
import { readIndexMeta } from './search-index-meta.js';
import { syncSearchIndex, parseIndexRecord } from './search-sync.js';
import { clearDbCache, resolveIndexDbPath } from './search-db.js';

const busyError = () => Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: 'database is locked' });

// Stands in for the db: keeps the file rows of each committed transaction, drops rolled-back ones.
const makeFakeDb = ({ failFirstCommit = false } = {}) => {
  const fake = { transactions: [], pending: null, commits: 0 };
  const commit = () => {
    fake.commits++;
    const isFailingCommit = failFirstCommit && fake.commits === 1;
    if (isFailingCommit) throw busyError();
    fake.transactions.push(fake.pending);
    fake.pending = null;
  };
  const verbs = { BEGIN: () => { fake.pending = []; }, ROLLBACK: () => { fake.pending = null; }, COMMIT: commit };
  fake.exec = (sql) => verbs[sql.split(/[ ;]/)[0]]?.();
  fake.prepare = (sql) => {
    const isFileRowInsert = sql.startsWith('INSERT INTO files');
    const run = isFileRowInsert ? (filePath) => fake.pending.push(filePath) : () => {};
    return { run };
  };
  return fake;
};

const makeRecords = (count) => Array.from({ length: count }, (_, i) => ({
  path: `src/f${i}.ts`, mtime: 1, size: 1, tier: 'prefab', lines: 1, chars: 1,
  symbols: [{ name: `useF${i}`, kind: 'const', isExport: true, startLine: 1 }]
}));

const makeProject = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-5919-batch-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  for (const [relPath, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relPath)), { recursive: true });
    fs.writeFileSync(path.join(root, relPath), body);
  }
  return root;
};

test('a batch commits after batchSize records, or after its first record once maxHoldMs has passed', () => {
  const records = makeRecords(5);
  const bySize = makeFakeDb();
  upsertFileIndexBatch(bySize, records, { batchSize: 2 });
  assert.deepEqual(bySize.transactions, [['src/f0.ts', 'src/f1.ts'], ['src/f2.ts', 'src/f3.ts'], ['src/f4.ts']]);
  const byTime = makeFakeDb();
  upsertFileIndexBatch(byTime, records, { maxHoldMs: 0 });
  assert.deepEqual(byTime.transactions, records.map((record) => [record.path]), 'one record per transaction once the hold budget is spent');
});

test('a retried batch restarts from its own first record, so each record is committed exactly once', () => {
  const fake = makeFakeDb({ failFirstCommit: true });
  upsertFileIndexBatch(fake, makeRecords(3), { batchSize: 2 });
  assert.equal(fake.commits, 3, 'the busy commit was retried');
  assert.deepEqual(fake.transactions, [['src/f0.ts', 'src/f1.ts'], ['src/f2.ts']]);
});

test('a sync records a new scope dir in the key before its rows, and commits the rows before the meta commit', () => {
  const root = makeProject({ 'a/x.js': 'export const xOne = 1;\n', 'c/z.js': 'export const zOne = 1;\n' });
  const dbPath = () => resolveIndexDbPath(root);
  let observer = null;
  let writer = null;
  try {
    syncSearchIndex('a', root);
    observer = new DatabaseSync(dbPath());
    writer = new DatabaseSync(dbPath());
    const seen = { keyAtFirstRow: null, rowAtMetaCommit: null };
    const prepare = writer.prepare.bind(writer);
    // What another connection can read at two moments: the first row write, and the final meta write.
    writer.prepare = (sql) => {
      const stmt = prepare(sql);
      const isFileRowInsert = sql.startsWith('INSERT INTO files');
      if (isFileRowInsert) {
        return { run: (...args) => { seen.keyAtFirstRow ??= readIndexMeta(observer).scope; return stmt.run(...args); } };
      }
      const isMetaWrite = sql.startsWith('INSERT INTO index_meta');
      if (isMetaWrite) {
        return { run: (key, value) => {
          const isFinalMetaWrite = key === 'syncedAt';
          if (isFinalMetaWrite) seen.rowAtMetaCommit = Boolean(observer.prepare("SELECT path FROM files WHERE path = 'c/z.js'").get());
          return stmt.run(key, value);
        } };
      }
      return stmt;
    };
    const record = parseIndexRecord(path.join(root, 'c/z.js'), 'c/z.js', root);
    const plan = { records: [record], removable: [], orphans: [], addDirs: ['c'], dropDirs: [] };
    const committed = commitSyncPlan(writer, plan, 2);
    assert.equal(committed.scopeKey, 'a,c');
    assert.equal(seen.keyAtFirstRow, 'a,c', 'a concurrent reader already saw c in the key when its first row was written');
    assert.equal(seen.rowAtMetaCommit, true, 'the rows were committed before, not inside, the meta commit');
    assert.equal(readIndexMeta(observer).scope, 'a,c');
  } finally {
    writer?.close();
    observer?.close();
    clearDbCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
