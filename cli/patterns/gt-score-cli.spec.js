// `chemx patterns --score --forge` refreshes the ledger before it groups (#2603): on a project where no
// sync ever ran, the score still sees the groups a `patterns --forge` run would.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPatternsScore } from './gt-score-cli.js';
import { openIndexDb } from '../search-schema.js';

delete process.env.CHEMX_PROJECT_ROOT;

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const makeProject = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-score-sync-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.chemx'));
  fs.mkdirSync(path.join(dir, 'lib'));
  for (const name of ['a.js', 'b.js']) fs.copyFileSync(path.join(KIT_ROOT, 'cli/team/team-flags.js'), path.join(dir, 'lib', name));
  fs.writeFileSync(path.join(dir, 'labels.json'), JSON.stringify({ items: [] }));
  return dir;
};

const quietly = (run) => {
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return run();
  } finally {
    process.stdout.write = write;
  }
};

test('--score --forge syncs the ledger first, so a never-synced project still scores its groups', (t) => {
  const dir = makeProject(t);
  const report = quietly(() => runPatternsScore([`--score=${path.join(dir, 'labels.json')}`, '--forge'], dir));
  const files = openIndexDb(dir).prepare('SELECT count(*) AS n FROM pattern_files').get().n;
  assert.equal(files, 2);
  assert.ok(report.groups > 0);
});
