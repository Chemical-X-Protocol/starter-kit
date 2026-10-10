// Spec support for the heal engine: a temp project seeded with copies of the A7 and A4 member files
// (cli/forge/fixtures/heal/<path>.txt, copied from the kit on 2026-10-09 before the real A7 heal), a
// covering spec for cli/project-detector.js, and 40 small filler modules so the A7 anchors are not
// ubiquitous (an anchor in more than 40% of a facet's files weighs 0 and the group would not surface).
// The project is fingerprinted, grouped, and the A7 and A4 blueprints are built and stored in its own
// index db. copySandbox() clones the prepared project so each spec starts from the same bytes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncFingerprints } from './fingerprint-sync.js';
import { runForgeGroups, readLedger } from './forge-groups.js';
import { openIndexDb } from '../search-schema.js';
import { createFacetResolver } from './facets.js';
import { createBlueprintContext } from './blueprint-context.js';
import { buildBlueprint } from './blueprint.js';
import { loadMatchableEntries } from './library-match.js';
import { groupByItem } from './blueprint-target.js';
import { saveBlueprint } from './blueprint-store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HEAL_FIXTURES = path.join(HERE, 'fixtures', 'heal');
export const KIT_ROOT = path.resolve(HERE, '..', '..');
const FILLERS = 40;

const COVERING_SPEC = `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProjectConfig } from './project-detector.js';

test('loadProjectConfig reads .chemx/config.json and falls back to {}', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-covering-'));
  try {
    assert.deepEqual(loadProjectConfig(dir), {});
    fs.mkdirSync(path.join(dir, '.chemx'));
    fs.writeFileSync(path.join(dir, '.chemx', 'config.json'), '{"a":1}');
    assert.deepEqual(loadProjectConfig(dir), { a: 1 });
    fs.writeFileSync(path.join(dir, '.chemx', 'config.json'), '{broken');
    assert.deepEqual(loadProjectConfig(dir), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
`;

const fixtureFiles = (dir = HEAL_FIXTURES, prefix = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const relative = path.posix.join(prefix, entry.name);
  const isDir = entry.isDirectory();
  if (isDir) return fixtureFiles(path.join(dir, entry.name), relative);
  return entry.name.endsWith('.js.txt') ? [relative.slice(0, -'.txt'.length)] : [];
});

/** The seeded member files, as project-relative paths in code-point order. */
export const healFixtureFiles = () => fixtureFiles().sort((a, b) => Number(a > b) - Number(a < b));

const writeFile = (dir, relative, text) => {
  const target = path.join(dir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
};

const seed = (dir) => {
  for (const file of healFixtureFiles()) writeFile(dir, file, fs.readFileSync(path.join(HEAL_FIXTURES, `${file}.txt`), 'utf-8'));
  for (let index = 0; index < FILLERS; index += 1) writeFile(dir, `cli/filler/f${index}.js`, `export const value${index} = (input) => {\n  const doubled = input * ${index + 2};\n  return doubled + ${index};\n};\n`);
  writeFile(dir, 'cli/project-detector.spec.js', COVERING_SPEC);
  writeFile(dir, 'package.json', '{ "name": "heal-sandbox", "private": true, "type": "module" }\n');
};

const readerIn = (dir) => (relative) => {
  try {
    return fs.readFileSync(path.join(dir, relative), 'utf-8');
  } catch {
    return null; // absent file
  }
};

/** Builds and stores the blueprint of a ground-truth item in the sandbox; { blueprint } or { error }. */
export const blueprintOf = (dir, item) => {
  const result = runForgeGroups(dir);
  const found = groupByItem(result.groups, item);
  const isMissing = Boolean(found.error);
  if (isMissing) return { error: found.error };
  const db = openIndexDb(dir);
  const context = createBlueprintContext({ root: dir, ledger: readLedger(db), groups: result.groups, readFile: readerIn(dir), entries: loadMatchableEntries(), packageRootOfFile: createFacetResolver(dir).packageRootOfFile });
  const blueprint = buildBlueprint(found.group, context);
  saveBlueprint(db, blueprint);
  return { blueprint };
};

/** A prepared sandbox: { dir, blueprints: { A7, A4 }, cleanup }. */
export const createHealSandbox = () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-heal-')));
  fs.mkdirSync(path.join(dir, '.chemx'));
  seed(dir);
  syncFingerprints(dir, { targetDir: dir, log: () => {} });
  const blueprints = { A7: blueprintOf(dir, 'A7').blueprint, A4: blueprintOf(dir, 'A4').blueprint };
  return { dir, blueprints, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

/**
 * A byte copy of a prepared sandbox's files in a new temp dir, with a fresh index db holding the
 * sandbox's blueprints (an index db refuses to open from a copied checkout, db-project-stamp.js).
 */
export const copySandbox = (sandbox) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-heal-copy-')));
  fs.cpSync(sandbox.dir, dir, { recursive: true, filter: (source) => !source.split(path.sep).includes('.chemx') });
  fs.mkdirSync(path.join(dir, '.chemx'));
  const db = openIndexDb(dir);
  for (const blueprint of Object.values(sandbox.blueprints).filter(Boolean)) saveBlueprint(db, blueprint);
  return { dir, db, readFile: readerIn(dir), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

/** Every file of a project dir outside .chemx as Map relative -> text (for byte-identity checks). */
export const snapshotTree = (dir, prefix = '') => {
  const files = new Map();
  for (const entry of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const isSkipped = relative === '.chemx';
    if (isSkipped) continue;
    const children = entry.isDirectory() ? snapshotTree(dir, relative) : new Map([[relative, fs.readFileSync(path.join(dir, relative), 'utf-8')]]);
    for (const [file, text] of children) files.set(file, text);
  }
  return files;
};
