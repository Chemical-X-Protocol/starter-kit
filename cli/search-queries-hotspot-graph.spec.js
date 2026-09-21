import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { calculateCascadingHotspotGraph } from './search-queries-hotspot-graph.js';
import { formatHotspotGraphReport } from './audit/reporter-hotspot-graph.js';

test('hotspot-graph: calculates cascading risk scores joining violations and blast radius', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE files (
      path TEXT PRIMARY KEY,
      tier TEXT,
      lines INTEGER
    );
    CREATE TABLE imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      importer_path TEXT NOT NULL,
      imported_symbol TEXT NOT NULL,
      source_module TEXT NOT NULL,
      resolved_path TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      rule TEXT NOT NULL,
      severity TEXT NOT NULL,
      pillar TEXT NOT NULL,
      line INTEGER NOT NULL DEFAULT 1,
      hazard TEXT NOT NULL,
      directive TEXT NOT NULL
    );
  `);

  const insertFile = db.prepare('INSERT INTO files (path, tier, lines) VALUES (?, ?, ?)');
  insertFile.run('src/core/base.ts', 'atom', 80);
  insertFile.run('src/feature/card.ts', 'molecule', 120);
  insertFile.run('src/view/page.ts', 'view', 200);

  const insertImport = db.prepare('INSERT INTO imports (importer_path, imported_symbol, source_module, resolved_path) VALUES (?, ?, ?, ?)');
  insertImport.run('src/feature/card.ts', 'Base', './base.js', 'src/core/base.ts');
  insertImport.run('src/view/page.ts', 'Card', './card.js', 'src/feature/card.ts');

  const insertViolation = db.prepare('INSERT INTO violations (file_path, rule, severity, pillar, line, hazard, directive) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertViolation.run('src/core/base.ts', 'CONTROL_FLOW_NESTED_TERNARY', 'CRITICAL', 'Control Flow', 10, 'Nested ternary', 'Refactor');
  insertViolation.run('src/core/base.ts', 'AI_SLOP_SHALLOW_CATCH', 'HIGH', 'AI Slop', 20, 'Shallow catch', 'Fix');

  const result = calculateCascadingHotspotGraph(db);
  assert.equal(result.count, 1);
  const hotspot = result.hotspots[0];
  assert.equal(hotspot.filePath, 'src/core/base.ts');
  assert.equal(hotspot.criticalCount, 1);
  assert.equal(hotspot.highCount, 1);
  assert.equal(hotspot.severityWeight, 12);
  assert.ok(hotspot.cascadingRisk >= 24);

  const report = formatHotspotGraphReport(result);
  assert.match(report, /Cascading Violation Hotspot Graph/);
  assert.match(report, /src\/core\/base\.ts/);
  assert.match(report, /Cascading Risk:/);
});

test('hotspot-graph: handles empty or invalid db gracefully', () => {
  assert.equal(calculateCascadingHotspotGraph(null).count, 0);
  const emptyReport = formatHotspotGraphReport({ count: 0, hotspots: [] });
  assert.match(emptyReport, /Zero cascading violation hotspots detected/);
});
