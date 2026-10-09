import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveCallScope, extractCallTarget, isMutatingCall } from './call-scope.js';
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

test('resolveCallScope: an absolute path never picks its own root, even under a chemx marker', () => {
  const outer = makeProject();
  try {
    fs.mkdirSync(path.join(outer, 'pkg', 'src'), { recursive: true });
    fs.writeFileSync(path.join(outer, 'pkg', 'package.json'), '{}');
    const file = path.join(outer, 'pkg', 'src', 'a.js');
    const scope = resolveCallScope({ target: { action: 'read', projectRoot: null, targetPath: file }, declaredRoot: null, bootRoot: null, env: {} });
    assert.strictEqual(scope.ok, false);
    assert.match(scope.error, /No project root/);
  } finally {
    cleanup(outer);
  }
});

test('resolveCallScope: home-directory writes are refused when only a package.json sits above them', () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-home-')));
  const declared = makeProject();
  fs.writeFileSync(path.join(home, 'package.json'), '{}');
  try {
    const target = extractCallTarget('chemx', { action: 'write', params: { path: path.join(home, '.bashrc') } });
    assert.strictEqual(resolveCallScope({ target, env: {} }).ok, false, 'no root at all');
    const scoped = resolveCallScope({ target, declaredRoot: declared, env: {} });
    assert.strictEqual(scoped.ok, false, 'declared elsewhere');
    assert.match(scoped.error, /outside project root/);
    assert.strictEqual(scoped.root, declared, 'refusal still names the resolved root');
  } finally {
    cleanup(home, declared);
  }
});

test('extractCallTarget: legacy tool names and aliases classify like their canonical action', () => {
  assert.strictEqual(extractCallTarget('chemx', { action: 'audit_build', params: {} }).action, 'build');
  assert.strictEqual(extractCallTarget('chemx_audit_build', { command: 'x' }).action, 'build');
  assert.strictEqual(isMutatingCall(extractCallTarget('chemx', { action: 'report_issue', params: { autoPost: true } })), true);
  assert.strictEqual(isMutatingCall(extractCallTarget('chemx_report_issue', { autoPost: true })), true);
  assert.strictEqual(isMutatingCall(extractCallTarget('chemx', { action: 'coordinator', params: {} })), true);
});

test('extractCallTarget: an empty or conflicting projectRoot is an error, never a fallthrough', () => {
  for (const empty of ['', false, 0]) {
    const target = extractCallTarget('chemx', { action: 'read', projectRoot: empty, params: { projectRoot: '/x' } });
    assert.ok(target.rootError, String(empty));
    assert.strictEqual(resolveCallScope({ target, declaredRoot: '/tmp', env: {} }).ok, false);
  }
  assert.ok(extractCallTarget('chemx', { action: 'read', projectRoot: '/a', params: { projectRoot: '/b' } }).rootError);
  assert.strictEqual(extractCallTarget('chemx', { action: 'read', projectRoot: '/a', params: { projectRoot: '/a/' } }).rootError, null);
});

test('resolveCallScope: absolute read outside any project and any known root is refused', () => {
  const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-bare-')));
  try {
    const scope = resolveCallScope({ target: { action: 'read', projectRoot: null, targetPath: path.join(bare, 'x.ts') }, declaredRoot: null, bootRoot: null, env: {} });
    assert.strictEqual(scope.ok, false);
    assert.match(scope.error, /No project root/);
  } finally {
    cleanup(bare);
  }
});

test('resolveCallScope: absolute write with no marker is refused', () => {
  const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-bare-')));
  try {
    const declared = makeProject();
    const scope = resolveCallScope({ target: { action: 'write', projectRoot: null, targetPath: path.join(bare, 'authorized_keys') }, declaredRoot: declared, bootRoot: null, env: {} });
    assert.strictEqual(scope.ok, false);
    assert.ok(scope.error.includes('authorized_keys'));
    cleanup(declared);
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

test('resolveCallScope: caller-supplied shell commands run only when they are project scripts', () => {
  const project = makeProject();
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { test: 'node --test', build: 'vite build' } }));
  try {
    const scopeOf = (command, env = {}) => resolveCallScope({ target: extractCallTarget('chemx', { action: 'test', projectRoot: project, params: { command } }), env });
    assert.strictEqual(scopeOf('head -n 1').ok, false);
    assert.match(scopeOf('head -n 1').error, /not a package\.json script/);
    assert.strictEqual(scopeOf('node --test').ok, true, 'script body');
    assert.strictEqual(scopeOf('npm run build').ok, true, 'named script');
    assert.strictEqual(scopeOf('pnpm test').ok, true, 'runner shorthand');
    assert.strictEqual(scopeOf('npm run deploy').ok, false, 'unknown script');
    assert.strictEqual(scopeOf('head -n 1', { CHEMX_MCP_ALLOW_SHELL: '1' }).ok, true, 'explicit opt-in');
    const build = extractCallTarget('chemx', { action: 'build', projectRoot: project, params: { command: 'echo hi && pwd' } });
    assert.strictEqual(resolveCallScope({ target: build, env: {} }).ok, false);
  } finally {
    cleanup(project);
  }
});

test('resolveCallScope: publishing issues, server restarts and triage audits need a declared root', () => {
  const boot = makeProject();
  try {
    const calls = [
      extractCallTarget('chemx', { action: 'issue', params: { error: 'x', autoPost: true } }),
      extractCallTarget('chemx', { action: 'check', params: { path: 'RESTART_MCP' } }),
      extractCallTarget('chemx', { action: 'audit', params: { triage: true } })
    ];
    for (const target of calls) {
      assert.strictEqual(resolveCallScope({ target, bootRoot: boot, env: {} }).ok, false, `${target.action} should be refused`);
    }
    const draftIssue = extractCallTarget('chemx', { action: 'issue', params: { error: 'x' } });
    assert.strictEqual(resolveCallScope({ target: draftIssue, bootRoot: boot, env: {} }).ok, true);
  } finally {
    cleanup(boot);
  }
});
