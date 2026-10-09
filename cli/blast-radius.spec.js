import test from "node:test";
import assert from "node:assert";
import { openIndexDb } from "./search-schema.js";
import { upsertFileIndex } from "./search-db.js";
import { calculateBlastRadius } from "./search-queries.js";

test("calculateBlastRadius: traverses downstream multi-tier dependencies", () => {
  const db = openIndexDb(':memory:');
  if (!db) return;

  // Set up mock components in DB:
  // a-test-btn (atom) <- m-test-grp (molecule) <- o-test-nav (organism)
  upsertFileIndex(db, {
    path: "src/ui/atoms/a-test-btn/a-test-btn.vue",
    mtime: Date.now(),
    size: 100,
    tier: "atom",
    lines: 20,
    chars: 400,
    symbols: [{ name: "AtomTestBtn", kind: "const", isExport: true, startLine: 1, endLine: 20 }],
    imports: []
  });

  upsertFileIndex(db, {
    path: "src/ui/molecules/m-test-grp/m-test-grp.vue",
    mtime: Date.now(),
    size: 200,
    tier: "molecule",
    lines: 40,
    chars: 800,
    symbols: [{ name: "MoleculeTestGrp", kind: "const", isExport: true, startLine: 1, endLine: 40 }],
    imports: [
      { importedSymbol: "AtomTestBtn", sourceModule: "../../atoms/a-test-btn/a-test-btn.vue", line: 2 }
    ]
  });

  upsertFileIndex(db, {
    path: "src/ui/organisms/o-test-nav/o-test-nav.vue",
    mtime: Date.now(),
    size: 300,
    tier: "organism",
    lines: 60,
    chars: 1200,
    symbols: [{ name: "OrganismTestNav", kind: "const", isExport: true, startLine: 1, endLine: 60 }],
    imports: [
      { importedSymbol: "MoleculeTestGrp", sourceModule: "../../molecules/m-test-grp/m-test-grp.vue", line: 3 }
    ]
  });

  upsertFileIndex(db, {
    path: "src/ui/molecules/m-test-grp/m-test-grp.spec.ts",
    mtime: Date.now(),
    size: 150,
    tier: "utility",
    lines: 30,
    chars: 600,
    symbols: [],
    imports: [
      { importedSymbol: "MoleculeTestGrp", sourceModule: "./m-test-grp.vue", line: 1 }
    ]
  });

  const blast = calculateBlastRadius(db, "a-test-btn");

  assert.strictEqual(blast.target, "a-test-btn");
  assert.ok(blast.totalImpactCount >= 3, "Should detect at least 3 downstream files");
  assert.strictEqual(blast.depth >= 2, true, "Should reach depth of at least 2");

  // Verify direct consumers (m-test-grp)
  const hasDirect = blast.directConsumers.some((c) => c.path.includes("m-test-grp.vue"));
  assert.strictEqual(hasDirect, true, "m-test-grp.vue should be a direct consumer");

  // Verify transitive consumers (o-test-nav)
  const hasTransitive = blast.transitiveConsumers.some((c) => c.path.includes("o-test-nav.vue"));
  assert.strictEqual(hasTransitive, true, "o-test-nav.vue should be a transitive consumer");

  // Verify impacted test file detection
  const hasTest = blast.impactedTests.some((t) => t.path.includes("m-test-grp.spec.ts"));
  assert.strictEqual(hasTest, true, "m-test-grp.spec.ts should be flagged as impacted test");
});

test("calculateBlastRadius: safely terminates on circular dependency cycles", () => {
  const db = openIndexDb(':memory:');
  if (!db) return;

  // Cycle: circ-a -> circ-b -> circ-a
  upsertFileIndex(db, {
    path: "src/ui/circ-a.ts",
    mtime: Date.now(),
    size: 100,
    tier: "utility",
    lines: 10,
    chars: 200,
    symbols: [{ name: "CircA", kind: "const", isExport: true }],
    imports: [{ importedSymbol: "CircB", sourceModule: "./circ-b", line: 1 }]
  });

  upsertFileIndex(db, {
    path: "src/ui/circ-b.ts",
    mtime: Date.now(),
    size: 100,
    tier: "utility",
    lines: 10,
    chars: 200,
    symbols: [{ name: "CircB", kind: "const", isExport: true }],
    imports: [{ importedSymbol: "CircA", sourceModule: "./circ-a", line: 1 }]
  });

  // Must not loop indefinitely or throw
  const blast = calculateBlastRadius(db, "src/ui/circ-a.ts", { maxDepth: 4 });
  assert.ok(blast.totalImpactCount > 0);
  assert.ok(blast.depth <= 4);
});

const seedGraph = (db, files, tiers = {}) => {
  for (const [filePath, imports] of Object.entries(files)) {
    upsertFileIndex(db, {
      path: filePath, mtime: 1, size: 1, tier: tiers[filePath] || 'utility', lines: 1, chars: 1,
      symbols: [{ name: filePath.split('/').pop().replace(/\..*$/, ''), kind: 'const', isExport: true }],
      imports, root: '/nonexistent-chemx-root'
    });
  }
};

test("calculateBlastRadius: an index.ts target never pulls in every import containing 'index'", () => {
  const db = openIndexDb(':memory:');
  seedGraph(db, {
    'src/routes/compass/store/index.ts': [],
    'src/routes/bazaar/store/index.ts': [],
    'src/routes/compass/views/dash.ts': [{ importedSymbol: 'useCompassStore', sourceModule: '../store/index', line: 1 }],
    'src/routes/compass/views/alias.ts': [{ importedSymbol: 'useCompassStore', sourceModule: '@/routes/compass/store', line: 1 }],
    'cli/audit.js': [{ importedSymbol: 'loadConfig', sourceModule: './config/index.js', line: 1 }],
    'src/routes/bazaar/composables/useBazaarPosState.ts': [{ importedSymbol: 'useBazaarStore', sourceModule: '../store/index', line: 1 }]
  });
  const blast = calculateBlastRadius(db, 'src/routes/compass/store/index.ts', { maxDepth: 1 });
  assert.deepEqual(blast.directConsumers.map((c) => c.path).sort(), ['src/routes/compass/views/alias.ts', 'src/routes/compass/views/dash.ts']);

  const ambiguous = calculateBlastRadius(db, 'index.ts');
  assert.equal(ambiguous.ambiguous, true, 'a basename shared by several files is ambiguous, not guessed');
  assert.ok(ambiguous.candidates.length >= 1);
  assert.equal(ambiguous.totalImpactCount, 0);
});

test('calculateBacktrace: every caller and root entry point appears once', async () => {
  const { calculateBacktrace } = await import('./search-queries.js');
  const db = openIndexDb(':memory:');
  seedGraph(db, {
    'src/stores/branding.ts': [],
    'src/views/BrandingSettings.vue': [
      { importedSymbol: 'branding', sourceModule: '../stores/branding', line: 1 },
      { importedSymbol: 'brandingHelper', sourceModule: '../stores/branding', line: 2 },
      { importedSymbol: '*', sourceModule: '../stores/branding', line: 3 }
    ],
    'src/views/Dashboard.vue': [{ importedSymbol: 'BrandingSettings', sourceModule: './BrandingSettings.vue', line: 1 }]
  }, { 'src/views/BrandingSettings.vue': 'view', 'src/views/Dashboard.vue': 'view' });
  const trace = calculateBacktrace(db, 'branding');
  const callerPaths = trace.callers.map((c) => c.path);
  assert.deepEqual(callerPaths, Array.from(new Set(callerPaths)), 'no duplicate callers');
  const rootPaths = trace.rootCallers.map((c) => c.path);
  assert.deepEqual(rootPaths, Array.from(new Set(rootPaths)), 'no duplicate root entry points');
  assert.deepEqual(trace.chains, Array.from(new Set(trace.chains)), 'no duplicate chains');
  assert.ok(callerPaths.includes('src/views/Dashboard.vue'));
  assert.deepEqual(rootPaths, ['src/views/Dashboard.vue'], 'a view that is itself imported is not a root entry point');
});

test('calculateCallTrace: external callees come from the traced file only, never a basename LIKE match', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { calculateCallTrace } = await import('./search-queries.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-trace-like-'));
  try {
    fs.mkdirSync(path.join(root, 'src/store'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/store/index.ts'), 'export const useStore = () => helperOnlyElsewhere();\n');
    const db = openIndexDb(':memory:');
    upsertFileIndex(db, { path: 'src/other/index.ts', mtime: 1, size: 1, tier: 'utility', lines: 1, chars: 1, root,
      symbols: [{ name: 'useStore', kind: 'const', isExport: false, startLine: 1, endLine: 1 }],
      imports: [{ importedSymbol: 'helperOnlyElsewhere', sourceModule: 'some-pkg', line: 1 }] });
    upsertFileIndex(db, { path: 'src/store/index.ts', mtime: 1, size: 1, tier: 'utility', lines: 1, chars: 1, root,
      symbols: [{ name: 'useStore', kind: 'const', isExport: true, startLine: 1, endLine: 1 }], imports: [] });
    const trace = calculateCallTrace(db, 'useStore', { root });
    assert.equal(trace.filePath, 'src/store/index.ts', 'the exported definition seeds the trace');
    const external = trace.callees.filter((c) => c.isExternal).map((c) => c.symbol);
    assert.deepEqual(external, [], 'an import in src/other/index.ts is not attributed to src/store/index.ts');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('calculateCallTrace: a callee resolves through the import edge, not the first path with that name', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { calculateCallTrace } = await import('./search-queries.js');
  const { syncSearchIndex } = await import('./search-sync.js');
  const { clearDbCache } = await import('./search-db.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-trace-edge-'));
  try {
    fs.mkdirSync(path.join(root, '.chemx'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const aOnly = () => 1;\nexport const fmt = () => aOnly();\n');
    fs.writeFileSync(path.join(root, 'src/b.ts'), 'export const bOnly = () => 2;\nexport const fmt = () => bOnly();\n');
    fs.writeFileSync(path.join(root, 'src/c.ts'), 'import { fmt } from "./b";\nexport const runIt = () => fmt();\n');
    fs.writeFileSync(path.join(root, 'src/d.ts'), 'import { fmt } from "some-pkg";\nexport const runExt = () => fmt();\n');
    const { db } = syncSearchIndex('src', root);
    const trace = calculateCallTrace(db, 'runIt', { root });
    const fmt = trace.callees.find((c) => c.symbol === 'fmt');
    assert.equal(fmt.file, 'src/b.ts');
    assert.deepEqual(fmt.callees.map((c) => c.symbol), ['bOnly']);
    const ext = calculateCallTrace(db, 'runExt', { root }).callees.find((c) => c.symbol === 'fmt');
    assert.equal(ext.isExternal, true, 'an import from a package is external, not some indexed fmt');
  } finally {
    clearDbCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
