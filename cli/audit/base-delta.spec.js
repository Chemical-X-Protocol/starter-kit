/**
 * The base-ref delta gate (#6091) compares each changed source file at a base ref with its
 * working-tree content and fails only when a rule's count rises in that file, so a change
 * is judged on its own diff and not on the repo-wide ratchet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateBaseDelta, summarizeBaseDelta } from './base-delta.js';
import { auditCode } from './rules.js';
import { readRatchet, writeRatchet, evaluateRatchet } from './ratchet.js';
import { runProjectVerify } from '../verify.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const INLINE_BOOLEAN = 'CONTROL_FLOW_INLINE_BOOLEAN';
const NESTED_TERNARY = 'CONTROL_FLOW_NESTED_TERNARY';

/** One CONTROL_FLOW_INLINE_BOOLEAN hazard per call. */
const BOOL = (name) => `export const ${name} = (a, b) => {\n  if (a && b) run();\n};\n`;
/** One CONTROL_FLOW_NESTED_TERNARY hazard per call. */
const NESTED = (name) => `export const ${name} = (a, b) => (a ? 1 : b ? 2 : 3);\n`;
const FILLER = Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i};\n`).join('');

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
const put = (root, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};

const initRepo = (files) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-base-delta-')));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'spec@example.invalid');
  git(root, 'config', 'user.name', 'spec');
  for (const [rel, content] of Object.entries(files)) put(root, rel, content);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  return root;
};

const withRepo = (files, fn) => {
  const root = initRepo(files);
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

/** A committed project `verify` can run in: stub typecheck and test scripts, an empty node_modules. */
const withProject = async (files, fn) => {
  const manifest = JSON.stringify({ name: 'base-delta-fixture', scripts: { test: 'node -e ""', typecheck: 'node -e ""' } });
  const root = initRepo({ 'package.json': manifest, ...files });
  fs.mkdirSync(path.join(root, 'node_modules'));
  try {
    await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const verifyJson = (root, ...args) => runProjectVerify([...args, '--json'], false, { cwd: root, print: false });

/** Everything `verify` prints to stdout while it runs, with colors stripped. */
const verifyText = async (root, ...args) => {
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => {
    out += String(chunk);
    return true;
  };
  try {
    await runProjectVerify(args, false, { cwd: root });
  } finally {
    process.stdout.write = original;
  }
  return out.replace(/\x1b\[[0-9;]*m/g, '');
};

const risesOf = (result) => result.files.flatMap((f) => f.increases.map((i) => [i.rule, i.before, i.after]));

test('a file with one hazard at base and still one after edits passes', () => {
  withRepo({ 'src/f.ts': BOOL('a') }, (root) => {
    put(root, 'src/f.ts', `${BOOL('a')}export const c = 1;\n`);
    const result = evaluateBaseDelta(root, 'HEAD');
    assert.equal(result.isPassing, true, JSON.stringify(risesOf(result)));
    assert.equal(result.checked, 1);
    assert.deepEqual(result.files, []);
  });
});

test('a second hazard of the same rule in that file fails and names the rule and site', () => {
  withRepo({ 'src/f.ts': BOOL('a') }, (root) => {
    put(root, 'src/f.ts', BOOL('a') + BOOL('b'));
    const result = evaluateBaseDelta(root, 'HEAD');
    assert.equal(result.isPassing, false);
    assert.deepEqual(risesOf(result), [[INLINE_BOOLEAN, 1, 2]]);
    const summary = summarizeBaseDelta(result);
    assert.equal(summary.files[0].sites.length, 1);
    assert.match(summary.files[0].sites[0], new RegExp(`^${INLINE_BOOLEAN}@src/f\\.ts:\\d+ \\[[A-Z]+\\]$`));
  });
});

test('fixing a rule-A hazard passes while rule B stays in an untouched file, though the repo-wide ratchet fails', () => {
  withRepo({ 'src/fix.ts': BOOL('a'), 'src/other.ts': NESTED('n') }, (root) => {
    put(root, 'src/fix.ts', 'export const a = (x, y) => {\n  const isBoth = x && y;\n  if (isBoth) run();\n};\n');
    const result = evaluateBaseDelta(root, 'HEAD');
    assert.equal(result.isPassing, true, JSON.stringify(risesOf(result)));
    assert.equal(result.checked, 1, 'only the changed file is compared');

    const violations = ['src/fix.ts', 'src/other.ts'].flatMap((rel) => auditCode(fs.readFileSync(path.join(root, rel), 'utf-8'), path.join(root, rel), rel, { config: {} }));
    writeRatchet(root, { scope: 'src', violations: [] });
    const ratchet = evaluateRatchet(readRatchet(root), { scope: 'src', violations });
    assert.equal(ratchet.status, 'fail', 'the repo-wide ratchet is red on rule B, which this change never touched');
    assert.ok(ratchet.regressions.some((r) => r.rule === NESTED_TERNARY));
  });
});

test('a rule-B hazard raised in a changed file fails even when rule A was fixed in it', () => {
  withRepo({ 'src/f.ts': BOOL('a') }, (root) => {
    put(root, 'src/f.ts', NESTED('n'));
    const result = evaluateBaseDelta(root, 'HEAD');
    assert.equal(result.isPassing, false);
    assert.deepEqual(risesOf(result), [[NESTED_TERNARY, 0, 1]]);
  });
});

test('a renamed-and-edited file compares with its old path', () => {
  withRepo({ 'src/svc.js': FILLER + BOOL('a') + BOOL('b') }, (root) => {
    git(root, 'mv', 'src/svc.js', 'src/service.js');
    put(root, 'src/service.js', `${FILLER}${BOOL('a')}${BOOL('b')}export const extra = 1;\n`);
    const neutral = evaluateBaseDelta(root, 'HEAD');
    assert.equal(neutral.isPassing, true, JSON.stringify(risesOf(neutral)));

    put(root, 'src/service.js', FILLER + BOOL('a') + BOOL('b') + BOOL('c'));
    const rising = evaluateBaseDelta(root, 'HEAD');
    assert.equal(rising.isPassing, false);
    assert.equal(rising.files[0].file, 'src/service.js');
    assert.equal(rising.files[0].renamedFrom, 'src/svc.js');
    assert.deepEqual(risesOf(rising), [[INLINE_BOOLEAN, 2, 3]]);
  });
});

test('a missing ref does not throw, and it does not pass', () => {
  withRepo({ 'src/f.ts': BOOL('a') }, (root) => {
    for (const ref of ['no-such-ref', '--output=/tmp/x', '', undefined]) {
      const result = evaluateBaseDelta(root, ref);
      assert.equal(result.baseMissing, true, String(ref));
      assert.equal(result.isPassing, false, String(ref));
      assert.deepEqual(result.files, []);
      assert.match(result.error, /unknown base revision/);
    }
  });
});

test('committed edits since the ref and unstaged working-tree edits both count', () => {
  withRepo({ 'src/f.ts': BOOL('a') }, (root) => {
    const baseSha = git(root, 'rev-parse', 'HEAD').trim();
    put(root, 'src/f.ts', BOOL('a') + BOOL('b'));
    git(root, 'commit', '-qam', 'second hazard');
    assert.equal(evaluateBaseDelta(root, baseSha).isPassing, false, 'committed after the base');
    assert.equal(evaluateBaseDelta(root, 'HEAD').isPassing, true, 'nothing changed since HEAD');
    put(root, 'src/f.ts', BOOL('a') + BOOL('b') + BOOL('c'));
    const result = evaluateBaseDelta(root, 'HEAD');
    assert.deepEqual(risesOf(result), [[INLINE_BOOLEAN, 2, 3]], 'unstaged edit over HEAD');
  });
});

test('an untracked new source file is compared with an empty base', () => {
  withRepo({ 'src/f.ts': 'export const a = 1;\n' }, (root) => {
    put(root, 'src/new.ts', NESTED('n'));
    const result = evaluateBaseDelta(root, 'HEAD');
    assert.equal(result.isPassing, false);
    assert.equal(result.files[0].file, 'src/new.ts');
  });
});

test('the base is the merge-base, so work that landed on the base branch after branching is not undone', () => {
  withRepo({ 'src/f.ts': BOOL('a') + BOOL('b') }, (root) => {
    const trunk = git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    git(root, 'checkout', '-q', '-b', 'feature');
    put(root, 'src/g.ts', 'export const g = 1;\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'feature work');
    git(root, 'checkout', '-q', trunk);
    put(root, 'src/f.ts', BOOL('a'));
    git(root, 'commit', '-qam', 'trunk fixes a hazard in f');
    git(root, 'checkout', '-q', 'feature');
    const result = evaluateBaseDelta(root, trunk);
    assert.equal(result.isPassing, true, JSON.stringify(risesOf(result)));
    assert.deepEqual(result.files, []);
  });
});

test('run from a package subdirectory, paths are relative to it', () => {
  withRepo({ 'pkg/src/f.ts': BOOL('a'), 'other/src/f.ts': BOOL('a') }, (root) => {
    put(root, 'pkg/src/f.ts', BOOL('a') + BOOL('b'));
    put(root, 'other/src/f.ts', BOOL('a') + BOOL('b'));
    const result = evaluateBaseDelta(path.join(root, 'pkg'), 'HEAD');
    assert.equal(result.isPassing, false);
    assert.deepEqual(result.files.map((f) => f.file), ['src/f.ts']);
  });
});

test('chemx audit --delta-base exits 1 on a rising rule and prints RULE@file:line, 0 otherwise', () => {
  withRepo({ 'src/f.ts': BOOL('a') }, (root) => {
    const run = (...args) => spawnSync(process.execPath, [CLI, 'audit', ...args], { cwd: root, encoding: 'utf-8' });
    const passing = run('--delta-base=HEAD');
    assert.equal(passing.status, 0, passing.stdout + passing.stderr);
    assert.match(passing.stdout, /Delta vs HEAD: no new hazards in changed files/);

    put(root, 'src/f.ts', BOOL('a') + BOOL('b'));
    const failing = run('--delta-base=HEAD');
    assert.equal(failing.status, 1, failing.stdout + failing.stderr);
    assert.match(failing.stdout, /Delta vs HEAD: changed files add hazards/);
    assert.match(failing.stdout, new RegExp(`${INLINE_BOOLEAN}@src/f\\.ts:\\d+ \\[[A-Z]+\\]`));

    const json = run('--delta-base', 'HEAD', '--json');
    assert.equal(json.status, 1);
    assert.equal(JSON.parse(json.stdout).isPassing, false);

    const missing = run('--delta-base=no-such-ref');
    assert.equal(missing.status, 1);
    assert.match(missing.stdout + missing.stderr, /unknown base revision "no-such-ref"/);
  });
});

test('verify --changed --base gates on the delta: a second hazard fails and the rising site is listed', async () => {
  await withProject({ 'src/f.ts': BOOL('a') }, async (root) => {
    put(root, 'src/f.ts', BOOL('a') + BOOL('b'));
    const summary = await verifyJson(root, '--changed', '--base=HEAD');
    assert.equal(summary.audit.basis, 'delta');
    assert.equal(summary.audit.passing, false);
    assert.equal(summary.audit.status, 'fail');
    assert.equal(summary.audit.delta.base, 'HEAD');
    assert.deepEqual(summary.audit.delta.files[0].increases.map((i) => [i.rule, i.before, i.after]), [[INLINE_BOOLEAN, 1, 2]]);
    assert.match(summary.audit.delta.files[0].sites[0], new RegExp(`^${INLINE_BOOLEAN}@src/f\\.ts:\\d+ \\[[A-Z]+\\]$`));

    const text = await verifyText(root, '--changed', '--base=HEAD');
    assert.match(text, /delta gate vs HEAD/);
    assert.match(text, new RegExp(`${INLINE_BOOLEAN}@src/f\\.ts:\\d+ \\[[A-Z]+\\]`));
  });
});

test('verify --changed --base passes a hazard-neutral edit to a legacy file', async () => {
  await withProject({ 'src/f.ts': BOOL('a') }, async (root) => {
    put(root, 'src/f.ts', `${BOOL('a')}export const c = 1;\n`);
    const summary = await verifyJson(root, '--changed', '--base=HEAD');
    assert.equal(summary.audit.basis, 'delta');
    assert.equal(summary.audit.passing, true);
    assert.deepEqual(summary.audit.delta.files, []);
    assert.match(await verifyText(root, '--changed', '--base=HEAD'), /delta gate vs HEAD/);
  });
});

test('verify --changed without --base keeps the severity gate and carries no delta block', async () => {
  await withProject({ 'src/f.ts': BOOL('a') }, async (root) => {
    put(root, 'src/f.ts', BOOL('a') + BOOL('b'));
    const summary = await verifyJson(root, '--changed');
    assert.equal(summary.audit.basis, 'severity');
    assert.equal(summary.audit.delta, undefined);
  });
});
