/**
 * Swarm spec hygiene (finding multiprocess-spec-cwd-dependent, plus the temp-project rule):
 * team and studio specs run from any cwd and never open the project's own .chemx/index.db,
 * which in the kit is the shared task backlog.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_DIR = fileURLToPath(new URL('..', import.meta.url));

const listSpecs = (dir, accept) => fs.readdirSync(dir)
  .filter((name) => name.endsWith('.spec.js') && accept(name))
  .map((name) => path.join(dir, name));

const SWARM_SPECS = [
  ...listSpecs(path.join(CLI_DIR, 'team'), (name) => name !== 'team-spec-hygiene.spec.js'),
  ...listSpecs(CLI_DIR, (name) => name.startsWith('ui')),
  path.join(CLI_DIR, 'mcp', 'tools-project.spec.js')
];

const findOffenders = (files, patterns) => files.flatMap((file) => {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  return lines.flatMap((line, index) => {
    const hit = patterns.find(({ test: matches }) => matches(line));
    return hit ? [`${path.relative(CLI_DIR, file)}:${index + 1} ${hit.why}`] : [];
  });
});

test('spec hygiene: child-process imports resolve from the spec file, not process.cwd()', () => {
  const offenders = findOffenders(SWARM_SPECS, [
    { test: (line) => /path\.resolve\(['"]cli\//.test(line), why: 'cwd-relative module path; use new URL(..., import.meta.url)' }
  ]);
  assert.deepEqual(offenders, []);
});

test('spec hygiene: source-tree scans resolve from the spec file, not process.cwd()', () => {
  const offenders = findOffenders(SWARM_SPECS, [
    { test: (line) => /path\.resolve\(process\.cwd\(\), ['"](cli|src)/.test(line), why: 'cwd-relative source dir; resolve from import.meta.url' }
  ]);
  assert.deepEqual(offenders, []);
});

test('spec hygiene: swarm specs use a temp project, never the cwd project db', () => {
  const offenders = findOffenders(SWARM_SPECS, [
    { test: (line) => line.includes('openIndexDb(process.cwd())'), why: 'opens the cwd project db' },
    { test: (line) => line.includes('openIndexDb()'), why: 'opens the default (cwd) project db' },
    { test: (line) => /startUiServer\(\{ port: 0 \}\)/.test(line), why: 'studio server defaults to the cwd project' },
    { test: (line) => /(startUiServer|createUiServer)\(.*process\.cwd\(\)/.test(line), why: 'studio server on the cwd project' }
  ]);
  assert.deepEqual(offenders, []);
});
