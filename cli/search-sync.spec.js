import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncSearchIndex, syncSingleFileIndex } from './search.js';
import { openIndexDb, clearDbCache, queryIndex } from './search-db.js';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));

const makeProject = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-g6-sync-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
};

const indexedPaths = (root) => openIndexDb(root).prepare('SELECT path FROM files ORDER BY path').all().map((r) => r.path);

const cleanup = (root) => {
  clearDbCache();
  fs.rmSync(root, { recursive: true, force: true });
};

test('sync from a subdirectory writes root-relative rows into the root index', () => {
  const root = makeProject({ 'src/mechanics/useQuokkaProbe.ts': 'export const useQuokkaProbe = () => 2;\n' });
  try {
    const subdir = path.join(root, 'src', 'mechanics');
    const res = syncSearchIndex(path.join(root, 'src'), subdir);
    assert.equal(res.status, 'fresh');
    assert.equal(res.root, root);
    assert.deepEqual(indexedPaths(root), ['src/mechanics/useQuokkaProbe.ts']);
    assert.equal(fs.existsSync(path.join(subdir, '.chemx')), false, 'no nested .chemx is created');
  } finally {
    cleanup(root);
  }
});

test('rows from an earlier --dir scope never leak into the default scope', () => {
  const root = makeProject({
    'src/a.ts': 'export const useAlpha = () => 1;\n',
    'other/otter.ts': 'export const useOtterLeak = () => 3;\n'
  });
  try {
    syncSearchIndex('other', root);
    assert.deepEqual(indexedPaths(root), ['other/otter.ts']);
    const res = syncSearchIndex('src', root);
    assert.deepEqual(res.scopeDirs, ['src']);
    const leaked = queryIndex(openIndexDb(root), { query: 'useOtterLeak', scopeDirs: res.scopeDirs });
    assert.equal(leaked.length, 0, 'out-of-scope symbol is not served');
    const own = queryIndex(openIndexDb(root), { query: 'useAlpha', scopeDirs: res.scopeDirs });
    assert.equal(own.length, 1);
  } finally {
    cleanup(root);
  }
});

test('syncing a sub-scope keeps the rest of the stored scope', () => {
  const root = makeProject({ 'src/a/one.ts': 'export const one = 1;\n', 'src/b/two.ts': 'export const two = 2;\n' });
  try {
    syncSearchIndex('src', root);
    syncSearchIndex('src/a', root);
    assert.deepEqual(indexedPaths(root), ['src/a/one.ts', 'src/b/two.ts']);
  } finally {
    cleanup(root);
  }
});

test('directory exclusions for build/blueprints/scratch apply only at the project root', () => {
  const root = makeProject({
    'src/components/blueprints/sub-app-billboard.ts': 'export const billboard = 1;\n',
    'cli/build/runner.js': 'export const runner = 1;\n',
    'blueprints/template.ts': 'export const template = 1;\n',
    'scratch/tmp.ts': 'export const tmp = 1;\n',
    'src/node_modules/pkg/index.js': 'export const pkg = 1;\n'
  });
  try {
    syncSearchIndex('.', root);
    assert.deepEqual(indexedPaths(root), ['cli/build/runner.js', 'src/components/blueprints/sub-app-billboard.ts']);
  } finally {
    cleanup(root);
  }
});

test('deleted files are pruned and single-file sync refuses out-of-scope paths', () => {
  const root = makeProject({ 'src/keep.ts': 'export const keep = 1;\n', 'src/gone.ts': 'export const gone = 1;\n', 'scratch/x.ts': 'export const x = 1;\n' });
  try {
    syncSearchIndex('src', root);
    fs.rmSync(path.join(root, 'src/gone.ts'));
    const res = syncSearchIndex('src', root);
    assert.equal(res.removedCount, 1);
    assert.deepEqual(indexedPaths(root), ['src/keep.ts']);
    const single = syncSingleFileIndex(path.join(root, 'scratch/x.ts'), root);
    assert.equal(single.status, 'out-of-scope');
    assert.deepEqual(indexedPaths(root), ['src/keep.ts']);
  } finally {
    cleanup(root);
  }
});

const runWorker = (root) => new Promise((resolve) => {
  const script = `
    const { openIndexDb } = await import(${JSON.stringify(path.join(CLI_DIR, 'search-schema.js'))});
    const { upsertFileIndex } = await import(${JSON.stringify(path.join(CLI_DIR, 'search-db.js'))});
    const db = openIndexDb(${JSON.stringify(root)});
    let failures = 0;
    let firstError = '';
    for (let i = 0; i < 50; i++) {
      try {
        upsertFileIndex(db, { path: 'src/shared-' + (i % 5) + '.ts', mtime: i, size: i, tier: 'utility', lines: 1, chars: 1, symbols: [{ name: 'shared' + i, kind: 'const', isExport: true }] });
      } catch (err) { failures++; firstError = firstError || err.message; }
    }
    process.stdout.write(failures + (firstError ? ' ' + firstError : ''));
  `;
  const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script]);
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.on('close', () => resolve(out.trim()));
});

test('concurrent processes upserting the same paths never hit UNIQUE failures', async () => {
  const root = makeProject({});
  try {
    openIndexDb(root);
    const failures = await Promise.all([runWorker(root), runWorker(root), runWorker(root), runWorker(root)]);
    assert.deepEqual(failures, ['0', '0', '0', '0']);
  } finally {
    cleanup(root);
  }
});

test('indexing scope honors .gitignore and excludes gitignored files from default index', async () => {
  const root = makeProject({
    '.gitignore': 'ignored/\n*.bak\n',
    'src/valid.ts': 'export const valid = 1;\n',
    'ignored/hidden.ts': 'export const hidden = 1;\n'
  });
  try {
    const { spawnSync } = await import('node:child_process');
    spawnSync('git', ['init'], { cwd: root });
    spawnSync('git', ['add', '.gitignore', 'src/valid.ts'], { cwd: root });
    syncSearchIndex('.', root);
    assert.deepEqual(indexedPaths(root), ['src/valid.ts']);

    fs.writeFileSync(path.join(root, '.chemxrc'), JSON.stringify({ exclude: ['src/skip-*.ts'] }));
    fs.writeFileSync(path.join(root, 'src/skip-me.ts'), 'export const skipMe = 1;\n');
    clearDbCache();
    syncSearchIndex('.', root, { reindex: true });
    assert.deepEqual(indexedPaths(root), ['src/valid.ts']);
  } finally {
    cleanup(root);
  }
});
