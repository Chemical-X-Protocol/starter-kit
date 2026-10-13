// Shared by the job line wiring specs: a throwaway project whose "test", "typecheck" and "build"
// commands are tiny node scripts that record what the line looked like while they ran, and a slot
// dir of their own so no spec touches the real one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENV, withDir } from './job-line-spec-helpers.js';

// Writes the slot dir listing (and the kind of every ticket in it) to argv[2] while it runs.
const PROBE = `const fs = require('fs'); const path = require('path');
const [out, dir, ...rest] = process.argv.slice(2);
const names = fs.readdirSync(dir);
const kinds = {};
for (const name of names.filter((entry) => entry.startsWith('ticket-'))) kinds[name] = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')).kind;
fs.appendFileSync(out, JSON.stringify({ names, kinds, rest }) + '\\n');
process.stdout.write('probe-out\\n');
`;

// Appends a line to argv[2] per run, so a spec counts how often the command really ran.
const COUNT = `require('fs').appendFileSync(process.argv[2], 'run\\n');
process.stdout.write('counted\\n');
`;

// The first run (one line in argv[2]) hangs until it is killed; any later run answers at once.
const HANG_FIRST = `const fs = require('fs');
fs.appendFileSync(process.argv[2], 'run\\n');
const runs = fs.readFileSync(process.argv[2], 'utf8').trim().split('\\n').length;
const isFirstRun = runs === 1;
if (isFirstRun) setTimeout(() => {}, 20000);
else process.stdout.write('second run\\n');
`;

export const lineEnv = (slots, extra = {}) => ({ ...ENV, CHEMX_TEST_SLOTS_DIR: slots, ...extra });

// A project dir (package.json and node_modules, so checkNodeModules passes) beside a slot dir.
export const withProject = (body) => withDir(async (slots) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-wiring-'));
  try {
    fs.writeFileSync(path.join(work, 'package.json'), '{}');
    fs.mkdirSync(path.join(work, 'node_modules'));
    for (const [name, source] of Object.entries({ 'probe.cjs': PROBE, 'count.cjs': COUNT, 'hang-first.cjs': HANG_FIRST, 'empty.cjs': '' })) fs.writeFileSync(path.join(work, name), source);
    await body({ slots, work, log: path.join(work, 'run.log') });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

export const probeCommand = (log, slots) => `node probe.cjs ${log} ${slots}`;
export const logLines = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
export const probed = (log) => logLines(log).map((line) => JSON.parse(line));

// A plan the way planTestCommand builds one, for a command that is not a real test runner.
export const planOf = (work, command, extra = {}) => ({ command, cwd: work, runner: 'jest', forwardsArgs: true, missingTargets: [], targets: [], ...extra });

// The text written to stdout while `body` runs. Binary chunks pass through: they are the test
// runner's own events, and swallowing them would lose tests.
export const captureStdout = async (body) => {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => {
    const isText = typeof chunk === 'string';
    if (isText) return chunks.push(chunk) > 0;
    return original.call(process.stdout, chunk, ...rest);
  };
  try {
    await body();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
};
