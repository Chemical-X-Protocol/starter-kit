import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runPublishBoth, resolvePublishExitCode } from '../scripts/publish-both.mjs';
import { isDirectRun } from '../scripts/direct-run.mjs';

const REAL_PKG_JSON = fileURLToPath(new URL('../package.json', import.meta.url));
const REAL_PKG_TEXT = fs.readFileSync(REAL_PKG_JSON, 'utf8');
const SCRIPT_PATH = fileURLToPath(new URL('../scripts/publish-both.mjs', import.meta.url));
const TMP_PKG_TEXT = '{"name":"x","version":"1.0.0"}\n';

const makePkgDir = (t, text = TMP_PKG_TEXT) => {
  const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-publish-both-'));
  t.after(() => fs.rmSync(pkgDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(pkgDir, 'package.json'), text, 'utf8');
  return pkgDir;
};

// The fake npm records every call and answers each target from a list of canned spawnSync results.
const makeFakeSpawn = (answers = []) => {
  const calls = [];
  const spawn = (command, args, options) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(options.cwd, 'package.json'), 'utf8'));
    calls.push({ command, args, options, publishedName: pkg.name });
    return answers[calls.length - 1] ?? { status: 0, signal: null };
  };
  return { spawn, calls };
};

const silenceConsole = (t) => {
  t.mock.method(console, 'log', () => {});
  return t.mock.method(console, 'error', () => {});
};

const run = (pkgDir, spawn, overrides = {}) =>
  runPublishBoth({ pkgDir, spawn, runGate: async () => {}, args: [], ...overrides });

test('publish-both: one failed target makes the run exit 1 and still restores package.json', async (t) => {
  const errorLog = silenceConsole(t);
  const pkgDir = makePkgDir(t);
  const { spawn, calls } = makeFakeSpawn([{ status: 0 }, { status: 0 }, { status: 1 }]);

  const exitCode = await run(pkgDir, spawn);

  assert.strictEqual(exitCode, 1);
  assert.strictEqual(calls.length, 6, 'a failed target must not stop the remaining publishes');
  assert.strictEqual(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'), TMP_PKG_TEXT);
  const failureLine = errorLog.mock.calls.map((call) => String(call.arguments[0])).join('\n');
  assert.match(failureLine, /1 of 6 target\(s\) failed: @chem-x\/starter-kit/);
});

test('publish-both: every target publishing returns exit code 0', async (t) => {
  const errorLog = silenceConsole(t);
  const pkgDir = makePkgDir(t);
  const { spawn, calls } = makeFakeSpawn();

  const exitCode = await run(pkgDir, spawn);

  assert.strictEqual(exitCode, 0);
  assert.deepStrictEqual(
    calls.map((call) => call.publishedName),
    ['create-chemx', '@chemx/starter-kit', '@chem-x/starter-kit', '@chemx/create-chemx', '@chem-x/create-chemx', 'chemx']
  );
  assert.strictEqual(errorLog.mock.callCount(), 0);
});

test('publish-both: a spawn failure (npm missing, null status) counts as a failed target', async (t) => {
  silenceConsole(t);
  const pkgDir = makePkgDir(t);
  const { spawn } = makeFakeSpawn([{ status: null, signal: null, error: new Error('spawnSync npm ENOENT') }]);

  assert.strictEqual(await run(pkgDir, spawn), 1);
});

test('publish-both: --dry-run reaches npm, which runs inside pkgDir', async (t) => {
  silenceConsole(t);
  const pkgDir = makePkgDir(t);
  const { spawn, calls } = makeFakeSpawn();
  const targets = [{ name: 'only-target', isScoped: false, bin: { chemx: 'cli/index.js' } }];

  await run(pkgDir, spawn, { targets, args: ['--dry-run'] });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].command, 'npm');
  assert.ok(calls[0].args.includes('--dry-run'), `missing --dry-run in ${calls[0].args.join(' ')}`);
  assert.strictEqual(calls[0].options.cwd, pkgDir);
  assert.strictEqual(calls[0].publishedName, 'only-target');
});

test('publish-both: --otp and --tag pass through, and a prerelease version defaults to the latest tag', async (t) => {
  silenceConsole(t);
  const targets = [{ name: 'only-target', isScoped: false, bin: { chemx: 'cli/index.js' } }];
  const explicit = makeFakeSpawn();
  await run(makePkgDir(t), explicit.spawn, { targets, args: ['--otp=123456', '--tag', 'next'] });
  assert.deepStrictEqual(explicit.calls[0].args, ['publish', '--access', 'public', '--otp=123456', '--tag', 'next']);

  const prerelease = makeFakeSpawn();
  await run(makePkgDir(t, '{"name":"x","version":"1.0.0-7"}\n'), prerelease.spawn, { targets, args: ['--tag=beta'] });
  assert.deepStrictEqual(prerelease.calls[0].args, ['publish', '--access', 'public', '--tag', 'beta']);

  const prereleaseDefault = makeFakeSpawn();
  await run(makePkgDir(t, '{"name":"x","version":"1.0.0-7"}\n'), prereleaseDefault.spawn, { targets, args: ['--tag', '--dry-run'] });
  assert.deepStrictEqual(prereleaseDefault.calls[0].args, ['publish', '--access', 'public', '--dry-run', '--tag', 'latest']);
});

test('publish-both: the pre-publish gate runs before any npm publish', async (t) => {
  silenceConsole(t);
  const order = [];
  const { spawn } = makeFakeSpawn();
  const recordingSpawn = (...spawnArgs) => {
    order.push('spawn');
    return spawn(...spawnArgs);
  };

  await run(makePkgDir(t), recordingSpawn, { runGate: async () => order.push('gate') });

  assert.strictEqual(order[0], 'gate');
  assert.strictEqual(order.length, 7);
});

test('publish-both: a throwing spawn still restores package.json and rejects', async (t) => {
  silenceConsole(t);
  const pkgDir = makePkgDir(t);
  const spawn = () => {
    throw new Error('boom');
  };

  await assert.rejects(run(pkgDir, spawn), /boom/);
  assert.strictEqual(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'), TMP_PKG_TEXT);
});

test('resolvePublishExitCode: 1 on any failure or an incomplete run, else 0', () => {
  const ok = { name: 'a', success: true };
  const failed = { name: 'b', success: false };
  assert.strictEqual(resolvePublishExitCode([ok, ok], 2), 0);
  assert.strictEqual(resolvePublishExitCode([ok, failed], 2), 1);
  assert.strictEqual(resolvePublishExitCode([ok], 2), 1, 'a run that stopped early is a failure');
  assert.strictEqual(resolvePublishExitCode([], 0), 0);
});

// Copies the whole real scripts/ folder, so shared helper modules come along, and links the kit.
const makeLinkedKit = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-publish-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const kitDir = path.join(root, 'kit');
  fs.cpSync(path.dirname(SCRIPT_PATH), path.join(kitDir, 'scripts'), { recursive: true });
  fs.symlinkSync(kitDir, path.join(root, 'kitlink'), 'dir');
  return { root, kitDir, linkDir: path.join(root, 'kitlink') };
};

const writeKitFile = (kitDir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(kitDir, rel)), { recursive: true });
  fs.writeFileSync(path.join(kitDir, rel), content, 'utf8');
};

// A copy of the script with a no-op gate, reached through a directory symlink, plus an npm that always fails.
const makeSymlinkedKit = (t) => {
  const { root, kitDir, linkDir } = makeLinkedKit(t);
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir);
  writeKitFile(kitDir, 'scripts/check-framework-generation.mjs', 'export const runFrameworkPrePublishGate = async () => {};\n');
  writeKitFile(kitDir, 'package.json', TMP_PKG_TEXT);
  fs.writeFileSync(path.join(binDir, 'npm'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  return { kitDir, binDir, linkedScript: path.join(linkDir, 'scripts', 'publish-both.mjs') };
};

test('publish-both: running through a symlinked path still publishes and exits 1 on failures', (t) => {
  const { kitDir, binDir, linkedScript } = makeSymlinkedKit(t);

  const proc = spawnSync(process.execPath, [linkedScript, '--dry-run'], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.strictEqual(proc.status, 1, `stdout: ${proc.stdout}\nstderr: ${proc.stderr}`);
  assert.match(proc.stderr, /6 of 6 target\(s\) failed/);
  assert.strictEqual(fs.readFileSync(path.join(kitDir, 'package.json'), 'utf8'), TMP_PKG_TEXT);
});

test('isDirectRun: argv[1] through a symlink matches the resolved module URL', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-direct-run-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const realDir = path.join(root, 'real');
  fs.mkdirSync(realDir);
  fs.writeFileSync(path.join(realDir, 'entry.mjs'), '', 'utf8');
  fs.writeFileSync(path.join(realDir, 'other.mjs'), '', 'utf8');
  fs.symlinkSync(realDir, path.join(root, 'link'), 'dir');
  // Node hands a module its resolved URL, so the fixture resolves the entry path the same way.
  const moduleUrl = pathToFileURL(fs.realpathSync(path.join(realDir, 'entry.mjs'))).href;

  assert.strictEqual(isDirectRun(path.join(root, 'link', 'entry.mjs'), moduleUrl), true);
  assert.strictEqual(isDirectRun(path.join(realDir, 'entry.mjs'), moduleUrl), true);
  assert.strictEqual(isDirectRun(path.join(realDir, 'other.mjs'), moduleUrl), false);
  assert.strictEqual(isDirectRun(path.join(root, 'missing.mjs'), moduleUrl), false);
  assert.strictEqual(isDirectRun(undefined, moduleUrl), false);
  assert.strictEqual(isDirectRun('', moduleUrl), false);
});

// The gate's own imports are stubbed: a generator that always fails and an empty typescript package.
test('check-framework-generation: running through a symlinked path still runs the gate and exits 1 on failures', (t) => {
  const { kitDir, linkDir } = makeLinkedKit(t);
  writeKitFile(kitDir, 'package.json', '{"name":"x","type":"module"}\n');
  writeKitFile(kitDir, 'cli/generator.js', 'export const runGenerateWizard = async () => ({ success: false });\n');
  writeKitFile(kitDir, 'cli/audit.js', 'export const auditFile = () => [];\n');
  writeKitFile(kitDir, 'node_modules/typescript/package.json', '{"name":"typescript","main":"index.js"}\n');
  writeKitFile(kitDir, 'node_modules/typescript/index.js', 'module.exports = {};\n');

  const linkedGate = path.join(linkDir, 'scripts', 'check-framework-generation.mjs');
  const proc = spawnSync(process.execPath, [linkedGate], { encoding: 'utf8', timeout: 15000 });

  assert.strictEqual(proc.status, 1, `stdout: ${proc.stdout}\nstderr: ${proc.stderr}`);
  assert.match(proc.stderr, /\[react\] Failed to scaffold capsule/);
  assert.match(proc.stderr, /Pre-publish framework gate FAILED/);
});

test('publish-both spec never rewrites the real package.json', () => {
  assert.strictEqual(fs.readFileSync(REAL_PKG_JSON, 'utf8'), REAL_PKG_TEXT);
});
