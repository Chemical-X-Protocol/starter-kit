import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectMarkdownFiles, checkMarkdownFiles, formatDocsReport } from './run.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(KIT_ROOT, 'cli', 'index.js');
// Dated design history (plans, reviews, specs) quotes commands as they were when written.
const HISTORY_DIRS = ['docs/superpowers/plans/', 'docs/superpowers/reviews/', 'docs/superpowers/specs/'];

test('docs check: the kit README, CLAUDE.md, AGENTS.md and docs/ name only commands that exist', () => {
  const files = collectMarkdownFiles(['README.md', 'CLAUDE.md', 'AGENTS.md', 'docs'], KIT_ROOT, HISTORY_DIRS);
  assert.ok(files.length >= 3, 'the kit docs were found');
  const result = checkMarkdownFiles(files, KIT_ROOT);
  assert.ok(result.checked > 50, `only ${result.checked} invocations were extracted`);
  assert.deepStrictEqual(result.failures, [], formatDocsReport(result));
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
