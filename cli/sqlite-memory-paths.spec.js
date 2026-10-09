import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chemxDbPathFor, chemxPathFor, isUsableProjectRoot } from './sqlite-memory.js';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_TARGETS = [':memory:', 'file::memory:', 'file:x?mode=memory'];

// Builds `<cwd>/<target>/.chemx` the way a stray earlier run would have left it: a real index db
// holding a live lease and a files row, plus history, baseline and discussion json.
const seedStrayChemx = (cwd, target) => {
  const chemxDir = path.join(cwd, target, '.chemx');
  fs.mkdirSync(chemxDir, { recursive: true });
  const db = new DatabaseSync(path.join(chemxDir, 'index.db'));
  db.exec('CREATE TABLE file_leases (file_path TEXT, locked_by TEXT, expires_at INTEGER, pid INTEGER, purpose TEXT)');
  db.exec('CREATE TABLE files (path TEXT, mtime INTEGER, size INTEGER)');
  db.prepare('INSERT INTO file_leases VALUES (?, ?, ?, ?, ?)').run('x.js', '@other', Date.now() + 3600000, 0, 'seed');
  db.prepare('INSERT INTO files VALUES (?, ?, ?)').run('x.js', 1, 1);
  db.close();
  for (const name of ['history.json', 'baseline.json', 'discussion.json']) {
    fs.writeFileSync(path.join(chemxDir, name), JSON.stringify(name === 'history.json' ? [{ health: { score: 1 } }] : { health: { score: 1 } }));
  }
};

// Snapshot of every file under the seeded dir, to prove nothing was rewritten or removed.
const snapshotTree = (dir) => {
  const out = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = fs.readFileSync(full).toString('hex');
    }
  };
  walk(dir);
  return out;
};

// Runs every cwd-to-.chemx entry point with a memory target in a child process, so process.cwd()
// is the temp dir, and prints each return value as JSON for the parent to assert on.
const ENTRY_POINT_SCRIPT = (target) => `
import path from 'node:path';
const base = ${JSON.stringify(pathToFileURL(CLI_DIR).href + '/')};
const target = ${JSON.stringify(target)};
const load = (rel) => import(new URL(rel, base).href);
const locks = await load('edit-locks.js');
const studio = await load('ui-db-studio.js');
const cards = await load('reader-cards.js');
const doctor = await load('doctor/check-index.js');
const history = await load('audit/history.js');
const discussion = await load('audit/discussion-store.js');
const friction = await load('friction/friction-export.js');
const wrappers = await load('commands/cmd-wrappers-git.js');
const fakeDb = { prepare: () => ({ get: () => ({}), all: () => [] }) };
const results = {
  lease: locks.findForeignLease(target, path.join(process.cwd(), 'x.js'), '@a'),
  metrics: studio.getDatabaseMetrics(fakeDb, target),
  cards: cards.buildReadCards(target, 'x.js', { connections: true }),
  index: await doctor.checkIndex({ projectRoot: target }),
  history: history.getAuditHistory(target),
  baseline: history.getAuditBaseline(target),
  setBaseline: history.setAuditBaseline({ health: { score: 5 } }, target),
  snapshot: history.saveAuditSnapshot({ metrics: {}, health: { score: 1, grade: 'F', label: 'x' }, violations: [] }, target),
  stored: discussion.getStoredDiscussion(target),
  saved: discussion.saveStoredDiscussion({ a: 1 }, target),
  cleared: discussion.clearStoredDiscussion(target),
  friction: friction.exportFriction({ root: target, entries: [{ ts: '2026-01-01', kind: 'k' }], target: 'friction.md' }),
};
await wrappers.tryMicroSyncModifiedFiles(target);
process.stdout.write(JSON.stringify(results));
`;

test('rejects memory targets and non-strings as project roots', () => {
  for (const target of MEMORY_TARGETS) assert.equal(isUsableProjectRoot(target), false);
  assert.equal(isUsableProjectRoot(''), false);
  assert.equal(isUsableProjectRoot(undefined), false);
  assert.equal(isUsableProjectRoot('/tmp/project'), true);
});

test('returns null .chemx paths for memory targets and joined paths otherwise', () => {
  for (const target of MEMORY_TARGETS) {
    assert.equal(chemxDbPathFor(target), null);
    assert.equal(chemxPathFor(target, 'history.json'), null);
  }
  assert.equal(chemxDbPathFor('/tmp/project'), path.join('/tmp/project', '.chemx', 'index.db'));
  assert.equal(chemxPathFor('/tmp/project', 'a', 'b'), path.join('/tmp/project', '.chemx', 'a', 'b'));
});

for (const target of MEMORY_TARGETS) {
  test(`every entry point with ${JSON.stringify(target)} ignores a stray seeded dir and writes nothing`, () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-memguard-'));
    try {
      seedStrayChemx(cwd, target);
      const before = snapshotTree(cwd);
      const env = { ...process.env, CHEMX_DEBUG: '1' };
      const run = spawnSync(process.execPath, ['--input-type=module', '-e', ENTRY_POINT_SCRIPT(target)], { cwd, env, encoding: 'utf-8', timeout: 60000 });
      assert.equal(run.status, 0, run.stderr);
      const got = JSON.parse(run.stdout);
      assert.equal(got.lease, null);
      assert.equal(got.metrics.fileSize, 0);
      assert.equal(got.metrics.dbPath, null);
      assert.match(got.index.summary, /no \.chemx\/index\.db yet/);
      assert.deepEqual(got.history, []);
      assert.equal(got.baseline, null);
      assert.deepEqual(got.setBaseline, { health: { score: 5 } });
      assert.equal(got.snapshot.totalAudits, 0);
      assert.deepEqual(got.snapshot.history, []);
      assert.equal(got.stored, null);
      assert.equal(got.saved, false);
      assert.equal(got.friction.appended, 0);
      assert.ok(!JSON.stringify(got.cards).includes('x.js'), 'cards must not read the seeded index');
      assert.ok(!run.stderr.includes('micro-sync'), `micro-sync must not run: ${run.stderr}`);
      assert.deepEqual(snapshotTree(cwd), before);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
}
