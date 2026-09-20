import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { buildFileTree, handleCodebaseIndex, handleCodebaseTree, handleCodebaseFile } from './ui-actions-codebase.js';
import { routeGet } from './ui-server-routes.js';
import { VIEW_FILETREE_TEMPLATE } from './ui-template-filetree.js';
import { UI_STYLES } from './ui-styles.js';
import { startUiServer } from './ui-server.js';

const setupTestDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      tier TEXT NOT NULL,
      lines INTEGER NOT NULL,
      chars INTEGER NOT NULL,
      health_score INTEGER NOT NULL DEFAULT 100,
      hazard_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      is_export INTEGER NOT NULL DEFAULT 0,
      start_line INTEGER NOT NULL DEFAULT 1,
      end_line INTEGER NOT NULL DEFAULT 1,
      signature TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      importer_path TEXT NOT NULL,
      imported_symbol TEXT NOT NULL,
      source_module TEXT NOT NULL,
      line INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      rule TEXT NOT NULL,
      severity TEXT NOT NULL,
      line INTEGER NOT NULL DEFAULT 1,
      hazard TEXT NOT NULL,
      directive TEXT NOT NULL
    );
  `);
  initTeamSchema(db);
  return db;
};

test('buildFileTree: constructs nested hierarchy with folder and file metadata', () => {
  const files = [
    { path: 'src/ui/atoms/Button.vue', lines: 45, tier: 'atom', healthScore: 100, hazardCount: 0 },
    { path: 'src/ui/molecules/Card.vue', lines: 120, tier: 'molecule', healthScore: 85, hazardCount: 1 },
    { path: 'cli/index.js', lines: 80, tier: 'utility', healthScore: 90, hazardCount: 0 }
  ];
  const tree = buildFileTree(files);
  assert.ok(Array.isArray(tree));
  assert.strictEqual(tree.length, 2);

  const srcFolder = tree.find((n) => n.name === 'src' && n.isFolder);
  assert.ok(srcFolder);
  assert.strictEqual(srcFolder.path, 'src');

  const cliFolder = tree.find((n) => n.name === 'cli' && n.isFolder);
  assert.ok(cliFolder);
  assert.strictEqual(cliFolder.children.length, 1);
  assert.strictEqual(cliFolder.children[0].name, 'index.js');
  assert.strictEqual(cliFolder.children[0].lines, 80);
});

test('handleCodebaseIndex and handleCodebaseTree: query SQLite files and build tree', () => {
  const db = setupTestDb();
  db.prepare("INSERT INTO files (path, mtime, size, tier, lines, chars, health_score, hazard_count) VALUES ('src/test.ts', 1, 100, 'atom', 50, 500, 100, 0)").run();
  db.prepare("INSERT INTO violations (file_path, rule, severity, line, hazard, directive) VALUES ('src/test.ts', 'R1', 'LOW', 5, 'hazard', 'directive')").run();

  const indexRes = handleCodebaseIndex(db);
  assert.strictEqual(indexRes.success, true);
  assert.strictEqual(indexRes.files.length, 1);
  assert.strictEqual(indexRes.files[0].path, 'src/test.ts');
  assert.strictEqual(indexRes.violations.length, 1);

  const treeRes = handleCodebaseTree(db);
  assert.strictEqual(treeRes.success, true);
  assert.strictEqual(treeRes.count, 1);
  assert.ok(treeRes.tree.length > 0);
});

test('handleCodebaseFile: returns file symbols, imports, caller connections, and hazards', () => {
  const db = setupTestDb();
  db.prepare("INSERT INTO files (path, mtime, size, tier, lines, chars, health_score, hazard_count) VALUES ('src/button.ts', 1, 100, 'atom', 40, 400, 100, 0)").run();
  db.prepare("INSERT INTO files (path, mtime, size, tier, lines, chars, health_score, hazard_count) VALUES ('src/consumer.ts', 1, 200, 'molecule', 90, 900, 100, 0)").run();
  db.prepare("INSERT INTO symbols (file_path, name, kind, is_export, start_line, end_line, signature) VALUES ('src/button.ts', 'renderButton', 'function', 1, 5, 15, '() => void')").run();
  db.prepare("INSERT INTO imports (importer_path, imported_symbol, source_module, line) VALUES ('src/button.ts', 'ref', 'vue', 1)").run();
  db.prepare("INSERT INTO imports (importer_path, imported_symbol, source_module, line) VALUES ('src/consumer.ts', 'renderButton', './button.js', 2)").run();
  db.prepare("INSERT INTO violations (file_path, rule, severity, line, hazard, directive) VALUES ('src/button.ts', 'NO_RAW_DOM', 'HIGH', 10, 'raw tag', 'wrap in atom')").run();

  const res = handleCodebaseFile(db, 'src/button.ts');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.file.path, 'src/button.ts');
  assert.strictEqual(res.file.lines, 40);
  assert.strictEqual(res.symbols.length, 1);
  assert.strictEqual(res.symbols[0].name, 'renderButton');
  assert.strictEqual(res.exports.length, 1);
  assert.strictEqual(res.imports.length, 1);
  assert.strictEqual(res.imports[0].symbol, 'ref');
  assert.strictEqual(res.connections.length, 1);
  assert.strictEqual(res.connections[0].importerPath, 'src/consumer.ts');
  assert.strictEqual(res.violations.length, 1);

  const missingRes = handleCodebaseFile(db, 'unknown.ts');
  assert.strictEqual(missingRes.success, false);
  const emptyRes = handleCodebaseFile(db, '');
  assert.strictEqual(emptyRes.success, false);
});

test('routeGet: resolves /api/codebase/tree and /api/codebase/file with symbols', () => {
  const db = setupTestDb();
  db.prepare("INSERT INTO files (path, mtime, size, tier, lines, chars, health_score, hazard_count) VALUES ('src/demo.ts', 1, 50, 'atom', 20, 200, 100, 0)").run();
  db.prepare("INSERT INTO symbols (file_path, name, kind, is_export, start_line, end_line, signature) VALUES ('src/demo.ts', 'DemoComp', 'component', 1, 1, 20, '')").run();

  const treeRes = routeGet('/api/codebase/tree', db);
  assert.ok(treeRes);
  assert.strictEqual(treeRes.success, true);
  assert.strictEqual(treeRes.count, 1);

  const fileRes = routeGet('/api/codebase/file?path=src/demo.ts', db);
  assert.ok(fileRes);
  assert.strictEqual(fileRes.success, true);
  assert.strictEqual(fileRes.symbols[0].name, 'DemoComp');

  const swarmTree = routeGet('/api/swarm/codebase/tree', db);
  assert.strictEqual(swarmTree.success, true);
  const swarmFile = routeGet('/api/swarm/codebase/file?path=src/demo.ts', db);
  assert.strictEqual(swarmFile.success, true);
});

test('template & styles: UI template contains required classes and metadata elements', () => {
  assert.ok(VIEW_FILETREE_TEMPLATE.includes('filetree-container'));
  assert.ok(VIEW_FILETREE_TEMPLATE.includes('filetree-folder'));
  assert.ok(VIEW_FILETREE_TEMPLATE.includes('filetree-file'));
  assert.ok(VIEW_FILETREE_TEMPLATE.includes('inspector-panel'));
  assert.ok(VIEW_FILETREE_TEMPLATE.includes('badge-hazard'));
  assert.ok(VIEW_FILETREE_TEMPLATE.includes('badge-lime'));
  assert.ok(VIEW_FILETREE_TEMPLATE.includes('badge-pink'));

  assert.ok(UI_STYLES.includes('.filetree-container'));
  assert.ok(UI_STYLES.includes('.filetree-folder'));
  assert.ok(UI_STYLES.includes('.filetree-file'));
  assert.ok(UI_STYLES.includes('.inspector-panel'));
  assert.ok(UI_STYLES.includes('.badge-hazard'));
});

test('ui-server: HTTP integration serves /api/codebase/tree and /api/codebase/file', async () => {
  const running = await startUiServer({ port: 0, cwd: process.cwd() });
  try {
    const resTree = await fetch(`http://localhost:${running.port}/api/codebase/tree`);
    assert.strictEqual(resTree.status, 200);
    const jsonTree = await resTree.json();
    assert.strictEqual(jsonTree.success, true);
    assert.ok(Array.isArray(jsonTree.tree));
    assert.ok(Array.isArray(jsonTree.files));

    const resFile = await fetch(`http://localhost:${running.port}/api/codebase/file?path=cli/ui-template.js`);
    assert.strictEqual(resFile.status, 200);
    const jsonFile = await resFile.json();
    assert.ok(typeof jsonFile === 'object');
  } finally {
    running.server.close();
  }
});
