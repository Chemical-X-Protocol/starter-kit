import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runWorker } from './worker-run.js';
import { buildScorecard } from './scorecard.js';

const workerFile = (body) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-worker-')), 'w.mjs');
  fs.writeFileSync(file, body);
  return pathToFileURL(file);
};

test('worker: a worker that dies without replying rejects at once, not at the timeout', async () => {
  const started = Date.now();
  await assert.rejects(runWorker(workerFile('process.exit(3);\n'), {}, { label: 'audit', timeoutMs: 60000 }), /audit worker exited with code 3 before replying/);
  assert.ok(Date.now() - started < 10000);
});

test('worker: the first message resolves and later exits are ignored', async () => {
  const url = workerFile("import { parentPort, workerData } from 'node:worker_threads';\nparentPort.postMessage({ echo: workerData.n });\n");
  assert.deepStrictEqual(await runWorker(url, { n: 7 }, { label: 'echo', timeoutMs: 60000 }), { echo: 7 });
});

test('scorecard: zero molecules is not 100 percent compliant', () => {
  assert.strictEqual(buildScorecard({ metrics: { moleculeCount: 0, moleculeCompliantPct: 100 } }).moleculeCompliantPct, null);
  assert.strictEqual(buildScorecard({}).moleculeCompliantPct, null);
  assert.strictEqual(buildScorecard({ metrics: { moleculeCount: 4, moleculeCompliantPct: 75 } }).moleculeCompliantPct, 75);
});
