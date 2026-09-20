import test from "node:test";
import assert from "node:assert";
import { openIndexDb } from "./search-schema.js";
import { upsertFileIndex } from "./search-db.js";
import { calculateBlastRadius } from "./search-queries.js";

test("calculateBlastRadius: traverses downstream multi-tier dependencies", () => {
  const db = openIndexDb();
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
  const db = openIndexDb();
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
