// Forge ledger store and floor (P2 part B): pattern_files / pattern_units round-trips, replacement
// returns the old and new fps for the dirty set, deletes hold with foreign_keys off, stamps follow the
// extractor version, and the store floor only drops rows no gate can use. Units come from live kit
// files through collectFileUnits.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { applyIndexSchema } from '../search-schema-ddl.js';
import { collectFileUnits } from './file-units.js';
import { createFacetResolver } from './facets.js';
import { anchorWeight, evidence } from './anchors.js';
import { selectStoredUnits, STORE_FLOOR } from './unit-floor.js';
import {
  replaceFileUnits, readFileStamps, isStampCurrent, removeLedgerFiles, listFileUnits, countLedgerUnits, FORGE_EXTRACTOR_VERSION
} from './store.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = 'cli/team/team-flags.js';

const openDb = ({ foreignKeys = true } = {}) => {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'};`);
  applyIndexSchema(db);
  return db;
};

const recordOf = (relPath) => {
  const content = fs.readFileSync(path.join(KIT_ROOT, relPath), 'utf-8');
  const { units } = selectStoredUnits(collectFileUnits(relPath, content).units);
  const facet = createFacetResolver(KIT_ROOT).facetOf(relPath, content);
  return { path: relPath, contentHash: 'sha-a', mtimeMs: 1, size: content.length, facet, units, droppedCount: 0 };
};

test('replaceFileUnits stores every unit and returns old and new fps', () => {
  const db = openDb();
  const record = recordOf(SOURCE);
  const first = replaceFileUnits(db, record);
  assert.deepEqual(first.previousFps, []);
  assert.equal(first.nextFps.length, record.units.length * 3);
  assert.equal(countLedgerUnits(db), record.units.length);

  const second = replaceFileUnits(db, { ...record, contentHash: 'sha-b' });
  assert.deepEqual([...second.previousFps].sort(), [...first.nextFps].sort());
  assert.equal(countLedgerUnits(db), record.units.length, 'a replacement never duplicates rows');
});

test('rows keep spans, facet and kind-specific meta', () => {
  const db = openDb();
  const record = recordOf(SOURCE);
  replaceFileUnits(db, record);
  const rows = listFileUnits(db, SOURCE);
  const fnRow = rows.find((row) => row.kind === 'fn');
  assert.ok(fnRow, 'team-flags.js has function units');
  assert.ok(Array.isArray(JSON.parse(fnRow.meta).paramNames));
  assert.ok(rows.every((row) => row.facet_key === 'js:plain:src:.' && row.is_spec === 0));
  assert.ok(rows.every((row) => row.start_line <= row.end_line));
  const stmtRows = rows.filter((row) => row.kind === 'stmt');
  assert.ok(stmtRows.every((row) => row.block_id > 0 && row.ordinal >= 0));
});

test('stamps carry the extractor version; another version is never current', () => {
  const db = openDb();
  replaceFileUnits(db, recordOf(SOURCE));
  const stamp = readFileStamps(db).get(SOURCE);
  assert.equal(stamp.extractorVersion, FORGE_EXTRACTOR_VERSION);
  assert.equal(isStampCurrent(stamp, 'sha-a'), true);
  assert.equal(isStampCurrent(stamp, 'sha-other'), false);
  assert.equal(isStampCurrent({ ...stamp, extractorVersion: FORGE_EXTRACTOR_VERSION + 1 }, 'sha-a'), false);
});

test('removeLedgerFiles deletes units even with foreign_keys off', () => {
  const db = openDb({ foreignKeys: false });
  replaceFileUnits(db, recordOf(SOURCE));
  const removedFps = removeLedgerFiles(db, [SOURCE]);
  assert.ok(removedFps.length > 0);
  assert.equal(countLedgerUnits(db), 0);
  assert.equal(readFileStamps(db).size, 0);
});

test('the kind column refuses unknown unit kinds', () => {
  const db = openDb();
  const record = recordOf(SOURCE);
  const bogus = { ...record.units[0], kind: 'bogus' };
  assert.throws(() => replaceFileUnits(db, { ...record, units: [bogus] }));
  assert.equal(countLedgerUnits(db), 0, 'the failed replacement rolled back');
});

test('the floor drops only units no solo gate or window can use', () => {
  const content = fs.readFileSync(path.join(KIT_ROOT, SOURCE), 'utf-8');
  const { units } = collectFileUnits(SOURCE, content);
  const kept = new Set(selectStoredUnits(units).units);
  const dropped = units.filter((unit) => !kept.has(unit));
  assert.ok(dropped.length > 0, 'team-flags.js has floor-dropped units');
  const stmtStarts = new Set(units.filter((unit) => unit.kind === 'stmt').map((unit) => unit.startOffset));
  for (const unit of dropped) {
    const isExprDuplicate = unit.kind === 'expr' && stmtStarts.has(unit.startOffset);
    const isBelowGates = unit.mass < STORE_FLOOR.minMass && evidence(unit.mass, anchorWeight(unit.anchors)) < STORE_FLOOR.minEvidence;
    assert.ok(isExprDuplicate || isBelowGates, `${unit.kind} at line ${unit.start} was dropped without cause`);
  }
});

test('the per-file cap keeps fn units first and reports what it dropped', () => {
  const content = fs.readFileSync(path.join(KIT_ROOT, SOURCE), 'utf-8');
  const { units } = collectFileUnits(SOURCE, content);
  const fnCount = selectStoredUnits(units).units.filter((unit) => unit.kind === 'fn').length;
  const capped = selectStoredUnits(units, { maxUnits: fnCount });
  assert.equal(capped.units.length, fnCount);
  assert.ok(capped.units.every((unit) => unit.kind === 'fn'));
  assert.ok(capped.capDropped > 0);
});
