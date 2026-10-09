import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatDocsReport } from './run.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(KIT_ROOT, 'cli', 'index.js');
test('docs check: the real default invocation is clean on the kit docs', () => {
  const run = spawnSync(process.execPath, [CLI, 'docs', 'check', '--json'], { cwd: KIT_ROOT, encoding: 'utf8' });
  const result = JSON.parse(run.stdout);
  assert.ok(result.files >= 3, 'the kit docs were found');
  assert.ok(result.checked > 50, `only ${result.checked} invocations were extracted`);
  assert.deepStrictEqual(result.failures, [], formatDocsReport(result));
  assert.strictEqual(run.status, 0);
});

test('docs check: a missing explicit path, or zero markdown files, exits 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-docs-check-'));
  const typo = spawnSync(process.execPath, [CLI, 'docs', 'check', 'nonexist.md'], { cwd: dir, encoding: 'utf8' });
  const empty = spawnSync(process.execPath, [CLI, 'docs', 'check', '--exclude=a'], { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.strictEqual(typo.status, 1);
  assert.match(typo.stderr, /no such path: nonexist\.md/);
  assert.strictEqual(empty.status, 1);
  assert.match(empty.stderr, /no markdown files found/);
});

test('docs check: a doc naming a missing command fails with file:line, text and reason', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-docs-check-'));
  fs.writeFileSync(path.join(dir, 'a.md'), 'ok\n\nRun `chemx verify` then `chemx definitely-not-a-command`.\n\n```bash\nchemx team task bogus 5\n```\n');
  const run = spawnSync(process.execPath, [CLI, 'docs', 'check', 'a.md'], { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.strictEqual(run.status, 1);
  assert.match(run.stdout, /a\.md:3 {2}chemx definitely-not-a-command/);
  assert.match(run.stdout, /unknown command "definitely-not-a-command"/);
  assert.match(run.stdout, /a\.md:6 {2}chemx team task bogus 5/);
  assert.match(run.stdout, /docs check: 2 failed\. 3 invocation\(s\) in 1 file\(s\)/);
});

test('docs check: a clean doc exits 0 and --exclude skips matching paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-docs-check-'));
  fs.mkdirSync(path.join(dir, 'old'));
  fs.writeFileSync(path.join(dir, 'good.md'), '`chemx verify`\n');
  fs.writeFileSync(path.join(dir, 'old', 'bad.md'), '`chemx nope-nope`\n');
  const clean = spawnSync(process.execPath, [CLI, 'docs', 'check', '.', '--exclude=old/'], { cwd: dir, encoding: 'utf8' });
  const dirty = spawnSync(process.execPath, [CLI, 'docs', 'check', '.'], { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.strictEqual(clean.status, 0);
  assert.strictEqual(dirty.status, 1);
});
