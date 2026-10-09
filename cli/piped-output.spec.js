import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCliAsync } from './spec-support/run-cli.js';

// Agents read chemx through pipes: no command may write ANSI escapes to a pipe, and CLI
// hints must use CLI syntax, not MCP call syntax.

const makeProject = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-piped-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'piped', version: '1.0.0', type: 'module' }));
  fs.writeFileSync(path.join(dir, 'src', 'small.js'), 'export const small = 1;\n');
  const longBody = Array.from({ length: 140 }, (_, i) => `export const value${i} = ${i};`).join('\n');
  fs.writeFileSync(path.join(dir, 'src', 'long.js'), `${longBody}\n`);
  return dir;
};

const PIPED_RUNS = [
  ['read', 'src/small.js'],
  ['read', 'src/long.js'],
  ['write', 'src/new.js', '--content=export const created = true;\n'],
  ['patch', 'src/small.js', '--target=small = 1', '--replacement=small = 2'],
  ['patch', 'src/small.js', '--target=not-present', '--replacement=x'],
  ['q', '-g', 'small'],
  ['q', 'small'],
  ['audit']
];

test('piped output: read, write, patch, q and audit carry no ANSI escapes', async () => {
  const project = makeProject();
  const runs = [];
  for (const args of PIPED_RUNS) runs.push(await runCliAsync(args, { cwd: project }));
  fs.rmSync(project, { recursive: true, force: true });
  for (const run of runs) {
    assert.strictEqual(run.signal, null, `chemx ${run.args.join(' ')} was killed`);
    assert.doesNotMatch(run.stdout + run.stderr, /\x1b/, `chemx ${run.args.join(' ')} wrote ANSI to a pipe`);
  }
});

test('piped output: the CLI read-window notice suggests CLI flags, not MCP call syntax', async () => {
  const project = makeProject();
  const run = await runCliAsync(['read', 'src/long.js'], { cwd: project });
  fs.rmSync(project, { recursive: true, force: true });
  assert.match(run.stdout, /chemx read src\/long\.js --symbol=<name>/);
  assert.match(run.stdout, /chemx read src\/long\.js:1-50/);
  assert.doesNotMatch(run.stdout, /chemx\(\{ action/);
});
