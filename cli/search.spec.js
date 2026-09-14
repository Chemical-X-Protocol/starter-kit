import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import {
  resolveTargetDir,
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
  queryFilesByHealth
} from './search.js';
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
  assert.ok(db, 'Expected sqlite database to be open');

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
  assert.ok(db, 'Expected sqlite database to be open');

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
  assert.ok(db, 'Expected sqlite database to be open');

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
  assert.ok(db);

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
  assert.ok(db);

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

