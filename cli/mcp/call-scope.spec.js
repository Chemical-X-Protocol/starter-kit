import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveCallScope, extractCallTarget } from './call-scope.js';
import { parseCommand } from './tools.js';

const makeProject = (marker = '.chemx') => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-scope-')));
  fs.mkdirSync(path.join(dir, marker), { recursive: true });
  return dir;
};
const cleanup = (...dirs) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));

test('resolveCallScope: explicit projectRoot wins over boot root', () => {
  const projectA = makeProject();
  const boot = makeProject();
  try {
    const scope = resolveCallScope({ target: { action: 'read', projectRoot: projectA, targetPath: 'a.js' }, declaredRoot: null, bootRoot: boot });
    assert.strictEqual(scope.ok, true);
    assert.strictEqual(scope.root, projectA);
    assert.strictEqual(scope.source, 'projectRoot');
  } finally {
    cleanup(projectA, boot);
  }
});

test('resolveCallScope: absolute path prefers nearest chemx marker over nearer package.json', () => {
  const outer = makeProject();
  try {
    fs.mkdirSync(path.join(outer, 'pkg', 'src'), { recursive: true });
    fs.writeFileSync(path.join(outer, 'pkg', 'package.json'), '{}');
    const file = path.join(outer, 'pkg', 'src', 'a.js');
    const scope = resolveCallScope({ target: { action: 'read', projectRoot: null, targetPath: file }, declaredRoot: null, bootRoot: null });
    assert.strictEqual(scope.root, outer);
    assert.strictEqual(scope.source, 'path');
  } finally {
    cleanup(outer);
  }
});

test('resolveCallScope: absolute read with no marker uses its own directory', () => {
  const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-bare-')));
  try {
    const scope = resolveCallScope({ target: { action: 'read', projectRoot: null, targetPath: path.join(bare, 'x.ts') }, declaredRoot: null, bootRoot: null });
    assert.strictEqual(scope.root, bare);
  } finally {
    cleanup(bare);
  }
});

test('resolveCallScope: absolute write with no marker is refused', () => {
  const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-bare-')));
  try {
    const scope = resolveCallScope({ target: { action: 'write', projectRoot: null, targetPath: path.join(bare, 'authorized_keys') }, declaredRoot: null, bootRoot: null });
    assert.strictEqual(scope.ok, false);
    assert.ok(scope.error.includes('authorized_keys'));
  } finally {
    cleanup(bare);
  }
});

test('resolveCallScope: pathless mutations are refused under boot fallback', () => {
  const boot = makeProject();
  try {
    const calls = [
      extractCallTarget('chemx', { action: 'autofix', params: {} }),
      extractCallTarget('chemx', { action: 'generate_capsule', params: { name: 'm-x' } }),
      extractCallTarget('chemx', { action: 'team_task', params: { subAction: 'claim', taskId: 1 } }),
      extractCallTarget('chemx', { action: 'team_post', params: { message: 'hi' } })
    ];
    for (const target of calls) {
      const scope = resolveCallScope({ target, declaredRoot: null, bootRoot: boot });
      assert.strictEqual(scope.ok, false, `${target.action} should be refused`);
    }
    const listing = extractCallTarget('chemx', { action: 'team_task', params: { subAction: 'list' } });
    assert.strictEqual(resolveCallScope({ target: listing, declaredRoot: null, bootRoot: boot }).ok, true);
  } finally {
    cleanup(boot);
  }
});

test('resolveCallScope: every path param is checked for escape', () => {
  const projectA = makeProject();
  try {
    const target = extractCallTarget('chemx', { action: 'generate', projectRoot: projectA, params: { dir: 'src', targetDir: '../../other/src' } });
    const scope = resolveCallScope({ target, declaredRoot: null, bootRoot: null });
    assert.strictEqual(scope.ok, false);
    assert.ok(scope.error.includes('../../other/src'));
  } finally {
    cleanup(projectA);
  }
});

test('parseCommand: audit without a path leaves scope to the resolver', () => {
  assert.strictEqual(parseCommand('audit', {}).params.path, undefined);
});

test('parseCommand: team task list forwards --all, --status, and --limit', () => {
  const parsed = parseCommand('team task list --status=done --limit=5 --all', {});
  assert.strictEqual(parsed.params.status, 'done');
  assert.strictEqual(parsed.params.limit, 5);
  assert.strictEqual(parsed.params.all, true);
});

test('resolveCallScope: refuses relative write when only boot root is known', () => {
  const boot = makeProject();
  try {
    const scope = resolveCallScope({ target: { action: 'write', projectRoot: null, targetPath: 'zz.js' }, declaredRoot: null, bootRoot: boot });
    assert.strictEqual(scope.ok, false);
    assert.ok(scope.error.includes('zz.js'));
    assert.ok(scope.error.includes(boot));
  } finally {
    cleanup(boot);
  }
});

test('resolveCallScope: allows relative read against boot root', () => {
  const boot = makeProject();
  try {
    const scope = resolveCallScope({ target: { action: 'read', projectRoot: null, targetPath: 'a.js' }, declaredRoot: null, bootRoot: boot });
    assert.strictEqual(scope.ok, true);
    assert.strictEqual(scope.source, 'boot');
  } finally {
    cleanup(boot);
  }
});

test('resolveCallScope: rejects path escaping project root', () => {
  const projectA = makeProject();
  try {
    const scope = resolveCallScope({ target: { action: 'read', projectRoot: projectA, targetPath: '../B/x.js' }, declaredRoot: null, bootRoot: null });
    assert.strictEqual(scope.ok, false);
    assert.ok(scope.error.includes('../B/x.js'));
    assert.ok(scope.error.includes(path.resolve(projectA, '../B/x.js')));
  } finally {
    cleanup(projectA);
  }
});

test('extractCallTarget: reads master-tool params and command strings', () => {
  const fromParams = extractCallTarget('chemx', { action: 'read', params: { path: 'src/a.js' } });
  assert.strictEqual(fromParams.targetPath, 'src/a.js');
  assert.strictEqual(fromParams.action, 'read');
  const fromCommand = extractCallTarget('chemx', { command: 'read src/b.js' });
  assert.strictEqual(fromCommand.targetPath, 'src/b.js');
  assert.strictEqual(fromCommand.action, 'read');
  const legacy = extractCallTarget('chemx_write', { path: '/tmp/x.js' });
  assert.strictEqual(legacy.action, 'write');
  assert.strictEqual(legacy.targetPath, '/tmp/x.js');
});
