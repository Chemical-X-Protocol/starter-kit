// Argument handling shared by chemx test, typecheck, build and verify: nothing the user typed
// may be silently dropped, and nothing may be silently reinterpreted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTestAudit } from './test-audit.js';
import { runTypecheckAudit } from './typecheck-audit.js';
import { runBuildAudit, resolveBuildCommand, BUILD_ARGS } from './build.js';
import { runProjectVerify } from './verify.js';
import { parseCliArgs } from './cli-args.js';
import { loadProjectConfig } from './config/index.js';
import { STATUS } from './result-status.js';

const withProject = async (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-cli-usage-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'u', type: 'module', scripts: { test: 'node --test src/*.spec.js' } }));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.mkdirSync(path.join(root, 'test'));
    fs.writeFileSync(path.join(root, 'test/a.spec.js'), "import test from 'node:test';\ntest('in test dir', () => {});\n");
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const quiet = (root) => ({ cwd: root, print: false });

test('cli-usage: `chemx test test` targets a directory named test instead of dropping it', { timeout: 60000 }, async () => {
  await withProject(async (root) => {
    const report = await runTestAudit(['test', '--json'], false, quiet(root));
    assert.match(report.command, /^node --test --test-concurrency=\d+ "test\/\*\*\/\*\.\{test,spec\}\.\{js,mjs,cjs\}"$/);
    assert.equal(report.passed, 1);
  });
});

test('cli-usage: an invalid --timeout is a usage error everywhere, not a silent default', { timeout: 60000 }, async () => {
  await withProject(async (root) => {
    const testReport = await runTestAudit(['--timeout=abc', '--json'], false, quiet(root));
    assert.equal(testReport.reason, 'USAGE');
    assert.match(testReport.executionError, /--timeout/);
    const typecheck = await runTypecheckAudit(['--timeout=-1', '--json'], false, quiet(root));
    assert.equal(typecheck.reason, 'USAGE', 'typecheck usage errors carry the same reason as test');
    const build = await runBuildAudit(['--timeout=abc', '--json'], false, quiet(root));
    assert.match(build.executionError, /--timeout/);
    const verify = await runProjectVerify(['--timeout=abc', '--json'], false, quiet(root));
    assert.equal(verify.status, STATUS.FAIL);
    assert.match(verify.error, /--timeout/);
  });
});

test('cli-usage: `chemx verify help` prints help and `chemx verify src` is a usage error, not a full verify', async () => {
  await withProject(async (root) => {
    const help = await runProjectVerify(['help', '--json'], false, quiet(root));
    assert.equal(help.help, true);
    const stray = await runProjectVerify(['src', '--json'], false, quiet(root));
    assert.equal(stray.status, STATUS.FAIL);
    assert.match(stray.error, /--dir/);
  });
});

test('cli-usage: --profile <name> (space form) selects the profile like --profile=<name>', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-cli-profile-'));
  try {
    assert.equal(loadProjectConfig(root, ['--profile', 'loose']).profile, 'loose');
    assert.equal(loadProjectConfig(root, ['--profile=loose']).profile, 'loose');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cli-usage: build/run/wrap keep a positional command intact, flags and all', () => {
  const resolve = (args) => resolveBuildCommand(parseCliArgs(args, BUILD_ARGS));
  assert.equal(resolve(['npm', 'run', 'build']), 'npm run build');
  assert.equal(resolve(['tsc', '-p', '.']), 'tsc -p .');
  assert.equal(resolve(['vite build']), 'vite build');
});

test('cli-usage: a flag chemx does not know, before any positional command, is still rejected', () => {
  const parsed = parseCliArgs(['--comand=exit 3'], BUILD_ARGS);
  assert.deepEqual(parsed.unknown, ['--comand=exit 3']);
});

test('cli-usage: a multi-word positional command is re-quoted word by word, so shell syntax in one word survives', () => {
  const resolve = (args) => resolveBuildCommand(parseCliArgs(args, BUILD_ARGS));
  assert.equal(resolve(['node', '-e', 'console.log(1+1)']), 'node -e "console.log(1+1)"');
  assert.equal(resolve(['FOO=1', 'node', 'x.js']), 'FOO=1 node x.js', 'an env assignment stays a bare word');
  assert.equal(resolve(['echo', "it's"]), `echo "it's"`);
  assert.equal(parseCliArgs(['--', 'node', '-e', 'console.log(1+1)'], BUILD_ARGS).command, 'node -e "console.log(1+1)"');
  assert.equal(parseCliArgs(['--', 'npm run build && echo ok'], BUILD_ARGS).command, 'npm run build && echo ok', 'one word is a whole shell command');
  assert.equal(parseCliArgs(['--', 'npm run build', '--mode=x'], BUILD_ARGS).command, 'npm run build --mode=x', 'a quoted command string followed by extra args');
});

test('cli-usage: chemx flags after the first command word belong to the command, not to chemx', () => {
  const parsed = parseCliArgs(['--json', 'node', '--help', '--json', '-h', '--timeout', '5'], BUILD_ARGS);
  assert.equal(parsed.flags.json, true);
  assert.equal(parsed.flags.help, undefined);
  assert.equal(parsed.values.timeout, undefined);
  assert.equal(resolveBuildCommand(parsed), 'node --help --json -h --timeout 5');
});

test('cli-usage: `chemx wrap node -e <code>` runs the code instead of a shell syntax error', { timeout: 60000 }, async () => {
  await withProject(async (root) => {
    const report = await runBuildAudit(['--json', 'node', '-e', 'console.log(1+1)'], false, quiet(root));
    assert.equal(report.status, STATUS.PASS, report.executionError || JSON.stringify(report.rawTail));
  });
});

test('cli-usage: `chemx typecheck <path>` is a usage error, not a silent whole-project check', async () => {
  await withProject(async (root) => {
    const report = await runTypecheckAudit(['src/a.js', '--json'], false, quiet(root));
    assert.equal(report.status, STATUS.FAIL);
    assert.equal(report.reason, 'USAGE');
    assert.match(report.executionError, /unexpected argument\(s\) src\/a\.js/);
  });
});

test('cli-usage: a --timeout setTimeout cannot honour (overflow or under 1ms) is a usage error', async () => {
  await withProject(async (root) => {
    const overflow = await runBuildAudit(['--timeout=3000000', '--json'], false, quiet(root));
    assert.match(overflow.executionError || '', /--timeout/, 'above 2^31-1 ms fires after 1ms');
    const tiny = await runTypecheckAudit(['--timeout=0.0001', '--json'], false, quiet(root));
    assert.equal(tiny.reason, 'USAGE', 'rounds to 0ms, which would disable the timeout');
  });
});
