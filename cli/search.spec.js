import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveTargetDir } from './search.js';
import {
  openIndexDb,
  upsertFileIndex,
  findSymbolDefinition,
  findSymbolReferences,
  findFileDependencies,
  findFileDependents,
  syncViolationsIndex,
  queryViolations,
  recordAuditSnapshot,
  getAuditProgression,
  queryFilesByHealth,
  queryHybridIndex
} from './search-db.js';
import {
  handleDefCommand,
  handleRefsCommand,
  handleDepsCommand,
  handleHazardsCommand,
  handlePackCommand,
  handleProgressionCommand,
  handleHealthFilterCommand
} from './search-commands.js';

test('resolveTargetDir: returns custom directory if provided as first argument', () => {
  const result = resolveTargetDir('packages/core', '--dir=other/path');
  assert.strictEqual(result, 'packages/core');
});

test('resolveTargetDir: resolves directory from dirFlag when custom directory is null', () => {
  const result = resolveTargetDir(null, '--dir=custom/target');
  assert.strictEqual(result, 'custom/target');
});

test('resolveTargetDir: resolves directory from single dirFlag argument', () => {
  const result = resolveTargetDir('--dir=apps/web');
  assert.strictEqual(result, 'apps/web');
});

test('resolveTargetDir: handles empty flag value cleanly', () => {
  const result = resolveTargetDir('--dir=');
  assert.strictEqual(result, '');
});

test('resolveTargetDir: defaults to src if present, otherwise . when no flags provided', () => {
  const expectedDefault = fs.existsSync('src') ? 'src' : '.';
  const resultNullArgs = resolveTargetDir(null, null);
  const resultNoArgs = resolveTargetDir();

  assert.strictEqual(resultNullArgs, expectedDefault);
  assert.strictEqual(resultNoArgs, expectedDefault);
});

test('search-db: indexes symbols with line ranges and finds definition', () => {
  const db = openIndexDb();
  if (!db) return;

  upsertFileIndex(db, {
    path: 'cli/fixtures/sample-module.js',
    mtime: Date.now(),
    size: 250,
    tier: 'utility',
    lines: 15,
    chars: 250,
    symbols: [
      { name: 'sampleFunction', kind: 'function', isExport: true, startLine: 3, endLine: 8, signature: 'export const sampleFunction = () => {' },
      { name: 'helperFunction', kind: 'function', isExport: false, startLine: 10, endLine: 14, signature: 'const helperFunction = () => {' }
    ],
    props: [],
    hooks: [],
    imports: [
      { importedSymbol: 'openIndexDb', sourceModule: './search-schema.js', line: 1 }
    ]
  });

  const def = findSymbolDefinition(db, 'sampleFunction');
  assert.ok(def, 'Expected symbol definition to be found');
  assert.strictEqual(def.name, 'sampleFunction');
  assert.strictEqual(def.startLine, 3);
  assert.strictEqual(def.endLine, 8);
  assert.strictEqual(def.filePath, 'cli/fixtures/sample-module.js');

  const defNotFound = findSymbolDefinition(db, 'nonExistentSymbolXYZ');
  assert.strictEqual(defNotFound, null);
});

test('search-db: tracks imports and references accurately', () => {
  const db = openIndexDb();
  if (!db) return;

  upsertFileIndex(db, {
    path: 'cli/fixtures/consumer-module.js',
    mtime: Date.now(),
    size: 150,
    tier: 'utility',
    lines: 10,
    chars: 150,
    symbols: [],
    props: [],
    hooks: [],
    imports: [
      { importedSymbol: 'sampleFunction', sourceModule: './sample-module.js', line: 2 }
    ]
  });

  const refs = findSymbolReferences(db, 'sampleFunction');
  assert.ok(Array.isArray(refs));
  assert.ok(refs.some((r) => r.importerPath === 'cli/fixtures/consumer-module.js'));

  const deps = findFileDependencies(db, 'cli/fixtures/consumer-module.js');
  assert.ok(deps.length >= 1);
  assert.strictEqual(deps[0].importedSymbol, 'sampleFunction');

  const dependents = findFileDependents(db, 'sample-module.js');
  assert.ok(Array.isArray(dependents));
});

test('search-db: syncs and queries violations index', () => {
  const db = openIndexDb();
  if (!db) return;

  const testViolations = [
    {
      filePath: 'cli/fixtures/hazard-test.js',
      rule: 'CONTROL_FLOW_NESTED_TERNARY',
      severity: 'CRITICAL',
      pillar: 'Control Flow & Boolean Logic',
      line: 42,
      hazard: 'Nested ternary detected',
      directive: 'Extract display states'
    },
    {
      filePath: 'cli/fixtures/hazard-test.js',
      rule: 'NAMING_BARE_BOOLEAN',
      severity: 'MEDIUM',
      pillar: 'Naming Conventions',
      line: 12,
      hazard: 'Bare boolean variable',
      directive: 'Prefix boolean with is/has'
    }
  ];

  const syncedCount = syncViolationsIndex(db, testViolations);
  assert.strictEqual(syncedCount, 2);

  const allHazards = queryViolations(db);
  assert.ok(allHazards.length >= 2);

  const criticalHazards = queryViolations(db, { severity: 'CRITICAL' });
  assert.ok(criticalHazards.every((h) => h.severity === 'CRITICAL'));

  const ruleHazards = queryViolations(db, { rule: 'CONTROL_FLOW_NESTED_TERNARY' });
  assert.ok(ruleHazards.every((h) => h.rule === 'CONTROL_FLOW_NESTED_TERNARY'));
});

test('search-commands: def, refs, deps, hazards, pack return valid payloads in JSON mode', () => {
  const db = openIndexDb();
  if (!db) return;

  const defRes = handleDefCommand(db, 'sampleFunction', { isJson: true, isCli: false });
  assert.strictEqual(defRes?.symbol, 'sampleFunction');

  const refsRes = handleRefsCommand(db, 'sampleFunction', { isJson: true, isCli: false });
  assert.strictEqual(refsRes?.symbol, 'sampleFunction');
  assert.ok(Array.isArray(refsRes?.references));

  const depsRes = handleDepsCommand(db, 'cli/fixtures/consumer-module.js', { isJson: true, isCli: false });
  assert.strictEqual(depsRes?.target, 'cli/fixtures/consumer-module.js');

  const hazardsRes = handleHazardsCommand(db, {}, { isJson: true, isCli: false });
  assert.ok(Array.isArray(hazardsRes?.hazards));

  const packRes = handlePackCommand(db, 'consumer-module.js', { isJson: true, isCli: false });
  assert.ok(packRes?.file);
  assert.ok(Array.isArray(packRes?.dependencies));
  assert.ok(Array.isArray(packRes?.dependents));
});

test('search-db: records snapshots, progression, and stamps file health', () => {
  const db = openIndexDb();
  if (!db) return;

  const mockReport = {
    health: { score: 98, grade: 'A+' },
    aiSlop: { asiScore: 94 },
    metrics: { totalLoc: 500 },
    scannedFiles: 10,
    violations: [
      { filePath: 'cli/fixtures/consumer-module.js', severity: 'HIGH', rule: 'AI_SLOP_SHALLOW_CATCH' }
    ]
  };

  const snapshotRes = recordAuditSnapshot(db, mockReport);
  assert.strictEqual(snapshotRes?.score, 98);
  assert.strictEqual(snapshotRes?.grade, 'A+');

  const history = getAuditProgression(db, 5);
  assert.ok(history.length >= 1);
  assert.strictEqual(history[history.length - 1].score, 98);

  const failingFiles = queryFilesByHealth(db, { status: 'failing' });
  assert.ok(failingFiles.some((f) => f.path === 'cli/fixtures/consumer-module.js'));

  const crystallineFiles = queryFilesByHealth(db, { status: 'crystalline' });
  assert.ok(crystallineFiles.every((f) => f.hazardCount === 0));

  const progressionCli = handleProgressionCommand(db, { isJson: true, isCli: false });
  assert.ok(progressionCli?.progression.length >= 1);

  const failingCli = handleHealthFilterCommand(db, 'failing', { isJson: true, isCli: false });
  assert.strictEqual(failingCli?.filter, 'failing');

  const cleanCli = handleHealthFilterCommand(db, 'crystalline', { isJson: true, isCli: false });
  assert.strictEqual(cleanCli?.filter, 'crystalline');
});

test('hybrid search: natural language "toggle a task item" ranks useTaskListController top-3 with valid ftsRank', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-search-rank-'));
  const db = openIndexDb(tmpDir);
  const mockComponents = [
    { path: 'src/molecules/m-task-list/useTaskListController.ts', name: 'useTaskListController', tier: 'hook', symbols: [{ name: 'useTaskListController', kind: 'function', isExport: true }, { name: 'toggleTaskItem', kind: 'function', isExport: false }], hooks: ['useState', 'useCallback'] },
    { path: 'src/molecules/m-user-avatar/useUserAvatar.ts', name: 'useUserAvatar', tier: 'hook', symbols: [{ name: 'useUserAvatar', kind: 'function', isExport: true }], hooks: ['useEffect'] },
    { path: 'src/molecules/m-tab-bar/useTabBar.ts', name: 'useTabBar', tier: 'hook', symbols: [{ name: 'useTabBar', kind: 'function', isExport: true }, { name: 'selectTabItem', kind: 'function', isExport: false }], hooks: ['useRef'] },
    { path: 'src/molecules/m-billing-card/useBillingCard.ts', name: 'useBillingCard', tier: 'hook', symbols: [{ name: 'useBillingCard', kind: 'function', isExport: true }], hooks: ['useState'] },
    { path: 'src/molecules/m-header/m-header.tsx', name: 'MHeader', tier: 'molecule', symbols: [{ name: 'MHeader', kind: 'component', isExport: true }], hooks: [] },
    { path: 'src/atoms/a-button/a-button.tsx', name: 'AtomButton', tier: 'atom', symbols: [{ name: 'AtomButton', kind: 'component', isExport: true }], hooks: [] },
    { path: 'src/atoms/a-input/a-input.tsx', name: 'AtomInput', tier: 'atom', symbols: [{ name: 'AtomInput', kind: 'component', isExport: true }], hooks: [] },
    { path: 'src/organisms/o-dashboard/o-dashboard.tsx', name: 'ODashboard', tier: 'organism', symbols: [{ name: 'ODashboard', kind: 'component', isExport: true }], hooks: [] }
  ];

  for (const comp of mockComponents) {
    upsertFileIndex(db, {
      path: comp.path,
      mtime: Date.now(),
      size: 500,
      tier: comp.tier,
      lines: 40,
      chars: 800,
      symbols: comp.symbols,
      props: [],
      hooks: comp.hooks,
      imports: []
    });
  }

  const results = queryHybridIndex(db, 'toggle a task item', { limit: 5 });
  assert.ok(results.length > 0, 'Must return results');

  const target = results.find((r) => r.name === 'useTaskListController');
  assert.ok(target, 'Target useTaskListController must be returned in results');
  assert.notStrictEqual(target.ftsRank, null, 'ftsRank must not be null');
  assert.ok(target.ftsRank >= 1, 'ftsRank must be valid positive rank');

  const targetIndex = results.findIndex((r) => r.name === 'useTaskListController');
  assert.ok(targetIndex >= 0 && targetIndex < 3, `Expected target in top 3, found at index ${targetIndex}`);

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

