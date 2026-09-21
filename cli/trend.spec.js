import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { renderSparkline, fetchScoreTrends, formatTrendReport } from './trend.js';

test('trend: renderSparkline produces correct ticks and handles empty/static input', () => {
  assert.equal(renderSparkline([]), '');
  assert.equal(renderSparkline([50, 50, 50]), '▅▅▅');
  const spark = renderSparkline([10, 30, 60, 100]);
  assert.equal(spark.length, 4);
  assert.equal(spark[0], ' ');
  assert.equal(spark[3], '█');
});

test('trend: fetchScoreTrends queries audit_snapshots in ascending chronological order', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE audit_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      score INTEGER NOT NULL,
      grade TEXT NOT NULL,
      critical_count INTEGER NOT NULL,
      high_med_count INTEGER NOT NULL,
      low_count INTEGER NOT NULL,
      scanned_files INTEGER NOT NULL
    );
  `);

  const insert = db.prepare(`
    INSERT INTO audit_snapshots (timestamp, score, grade, critical_count, high_med_count, low_count, scanned_files)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(1000, 70, 'C', 2, 5, 10, 20);
  insert.run(2000, 85, 'B', 1, 2, 5, 20);
  insert.run(3000, 95, 'A', 0, 0, 2, 20);

  const trends = fetchScoreTrends(db, 2);
  assert.equal(trends.length, 2);
  assert.equal(trends[0].score, 85);
  assert.equal(trends[1].score, 95);

  const report = formatTrendReport(trends);
  assert.match(report, /Score Trend \(2 snapshots\)/);
  assert.match(report, /\+10 pts/);
});

test('trend: formatTrendReport handles empty snapshots gracefully', () => {
  const emptyReport = formatTrendReport([]);
  assert.match(emptyReport, /No audit snapshots found/);
});
