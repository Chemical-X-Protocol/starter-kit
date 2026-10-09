import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLI_PATH } from './spec-support/run-cli.js';

// `chemx <cmd> | head` closes stdout early. That is the reader's choice, not a crash:
// chemx exits quietly and never files a failure report into the project.
const runWithClosedStdout = (args, cwd) => new Promise((resolve) => {
  const child = spawn(process.execPath, [CLI_PATH, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, killSignal: 'SIGKILL' });
  child.stdout.destroy();
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (status, signal) => resolve({ args, status, signal, stderr }));
});

test('epipe: a closed stdout pipe ends chemx quietly without a crash report', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-epipe-'));
  fs.mkdirSync(path.join(project, 'src'));
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"epipefx","version":"1.0.0","type":"module"}');
  fs.writeFileSync(path.join(project, 'src', 'big.js'), Array.from({ length: 4000 }, (_, i) => `export const v${i} = ${i};`).join('\n'));
  const runs = await Promise.all([['read', 'src/big.js', '--full'], ['audit', '--json'], ['help']].map((args) => runWithClosedStdout(args, project)));
  const hasIssueDir = fs.existsSync(path.join(project, '.chemx', 'issues'));
  fs.rmSync(project, { recursive: true, force: true });

  for (const run of runs) {
    const label = `chemx ${run.args.join(' ')}`;
    assert.strictEqual(run.signal, null, `${label} was killed`);
    assert.doesNotMatch(run.stderr, /EPIPE|Command Failed|issue/i, `${label} reported the closed pipe as a failure`);
  }
  assert.strictEqual(hasIssueDir, false, 'a closed pipe must not file a failure report');
});
