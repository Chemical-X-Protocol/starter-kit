import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readKitFile = (rel) => fs.readFileSync(path.join(KIT_DIR, rel), 'utf-8');

test('package hygiene: engines.node declares the node:sqlite floor (22.13)', () => {
  const pkg = JSON.parse(readKitFile('package.json'));
  assert.ok(pkg.engines && pkg.engines.node, 'engines.node is declared');
  assert.match(pkg.engines.node, /^>=\s*22\.13/);
});

test('package hygiene: publish summary fails when any target fails or never ran', async () => {
  const { computePublishExitCode } = await import('../scripts/publish-summary.mjs');
  assert.strictEqual(computePublishExitCode([{ name: 'a', success: true }, { name: 'b', success: true }], 2), 0);
  assert.strictEqual(computePublishExitCode([{ name: 'a', success: true }, { name: 'b', success: false }], 2), 1);
  assert.strictEqual(computePublishExitCode([{ name: 'a', success: true }], 2), 1);
  assert.strictEqual(computePublishExitCode([], 0), 1);
});

test('package hygiene: publish-both sets its exit code from the summary', () => {
  const source = readKitFile('scripts/publish-both.mjs');
  assert.match(source, /process\.exitCode\s*=\s*computePublishExitCode\(/);
});

test('package hygiene: the publish workflow runs the test suite before publishing', () => {
  const workflow = readKitFile('.github/workflows/publish.yml');
  const testIndex = workflow.indexOf('run: npm test');
  const publishIndex = workflow.indexOf('run: npm run publish:both');
  assert.ok(testIndex !== -1 && testIndex < publishIndex, 'npm test runs before publish:both');
});
