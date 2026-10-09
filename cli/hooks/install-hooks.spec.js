import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseInstallArgs, runInstallHooks } from './install-hooks-cli.js';
import { buildGitHubWorkflowScript, buildPreCommitHookScript } from '../installer-templates.js';
import { readKitVersion } from './launcher.js';

const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });

const makeProject = ({ kitInside = false } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-install-'));
  const kit = kitInside ? path.join(root, 'tools', 'kit') : fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-kit-'));
  created.push(root, kit);
  fs.mkdirSync(path.join(kit, 'cli', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'package.json'), JSON.stringify({ version: '1.2.3-4' }));
  fs.writeFileSync(path.join(kit, 'cli', 'index.js'), '');
  return { root, kit };
};
const install = ({ root, kit }, extra = []) => runInstallHooks(parseInstallArgs(['--host=claude', `--root=${root}`, `--kit=${kit}`, ...extra], root));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf-8'));
const settingsOf = (root, name = 'settings.local.json') => readJson(path.join(root, '.claude', name));
const commandsOf = (groups) => groups.flatMap((group) => group.hooks.map((hook) => hook.command));

test('fresh install writes the three hook events, statusLine and the .mcp.json launch', () => {
  const project = makeProject();
  const report = install(project);
  assert.equal(report.status, 'pass');
  const settings = settingsOf(project.root);
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['PostToolUse', 'PreToolUse', 'SessionStart']);
  assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /cli\/hooks\/entry\.js" claude-pre-tool$/);
  assert.match(settings.statusLine.command, /statusline$/);
  const server = readJson(path.join(project.root, '.mcp.json')).mcpServers['chemical-x'];
  assert.deepEqual(server, { command: 'node', args: [path.join(project.kit, 'cli', 'index.js'), 'mcp'], env: { CHEMX_PROJECT_ROOT: project.root, NO_COLOR: '1' } });
});

test('second run is a no-op: every file unchanged, no backups', () => {
  const project = makeProject();
  install(project);
  const before = fs.readFileSync(path.join(project.root, '.claude', 'settings.local.json'), 'utf-8');
  const report = install(project);
  assert.deepEqual(report.actions.map((action) => action.status), ['unchanged', 'unchanged']);
  assert.equal(fs.readFileSync(path.join(project.root, '.claude', 'settings.local.json'), 'utf-8'), before);
  assert.equal(fs.existsSync(path.join(project.root, '.chemx', 'backups')), false);
});

test('foreign hooks are kept verbatim; the bootstrap guard is replaced in place, never duplicated', () => {
  const project = makeProject();
  const foreign = { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-audit-logger' }] };
  const bootstrap = { matcher: 'Bash|Grep', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/chemx-guard.mjs"', timeout: 10 }] };
  const later = { matcher: 'Write', hooks: [{ type: 'command', command: 'other-tool' }] };
  fs.mkdirSync(path.join(project.root, '.claude'));
  fs.writeFileSync(path.join(project.root, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { PreToolUse: [foreign, bootstrap, later] } }));
  const report = install(project);
  const settings = settingsOf(project.root);
  assert.deepEqual(settings.permissions, { allow: ['Bash(ls)'] });
  assert.deepEqual(settings.hooks.PreToolUse[0], foreign);
  assert.match(settings.hooks.PreToolUse[1].hooks[0].command, /claude-pre-tool$/);
  assert.deepEqual(settings.hooks.PreToolUse[2], later);
  assert.equal(commandsOf(settings.hooks.PreToolUse).filter((command) => /chemx-guard|claude-pre-tool/.test(command)).length, 1);
  const backup = report.actions[0].backup;
  assert.match(fs.readFileSync(backup, 'utf-8'), /chemx-guard\.mjs/);
});

test('a foreign statusLine and a foreign chemical-x server are refused (exit 3), not clobbered', () => {
  const project = makeProject();
  fs.mkdirSync(path.join(project.root, '.claude'));
  fs.writeFileSync(path.join(project.root, '.claude', 'settings.local.json'), JSON.stringify({ statusLine: { type: 'command', command: 'starship prompt' } }));
  const foreignServer = { mcpServers: { 'chemical-x': { command: 'python', args: ['other.py'] } } };
  fs.writeFileSync(path.join(project.root, '.mcp.json'), JSON.stringify(foreignServer));
  const report = install(project);
  assert.equal(report.status, 'inconclusive');
  assert.equal(settingsOf(project.root).statusLine.command, 'starship prompt');
  assert.deepEqual(readJson(path.join(project.root, '.mcp.json')), foreignServer);
  assert.equal(report.actions[1].status, 'refused');
});

test('a stale chemx server launch is repointed and keeps extra env keys', () => {
  const project = makeProject();
  fs.writeFileSync(path.join(project.root, '.mcp.json'), JSON.stringify({ mcpServers: { 'chemical-x': { command: 'npx', args: ['-y', 'chemx@26.9.20-1257', 'mcp'], env: { DEBUG: '1' } }, other: { command: 'x' } } }));
  install(project);
  const config = readJson(path.join(project.root, '.mcp.json'));
  assert.deepEqual(config.mcpServers.other, { command: 'x' });
  assert.deepEqual(config.mcpServers['chemical-x'].env, { DEBUG: '1', CHEMX_PROJECT_ROOT: project.root, NO_COLOR: '1' });
  assert.equal(config.mcpServers['chemical-x'].command, 'node');
});

test('--dry-run reports the plan and writes nothing; malformed settings fail without writing', () => {
  const project = makeProject();
  const dry = install(project, ['--dry-run']);
  assert.deepEqual(dry.actions.map((action) => [action.status, action.written]), [['create', false], ['create', false]]);
  assert.equal(fs.existsSync(path.join(project.root, '.claude')), false);
  fs.mkdirSync(path.join(project.root, '.claude'));
  fs.writeFileSync(path.join(project.root, '.claude', 'settings.local.json'), '{ "hooks": ');
  const broken = install(project);
  assert.equal(broken.status, 'fail');
  assert.equal(fs.readFileSync(path.join(project.root, '.claude', 'settings.local.json'), 'utf-8'), '{ "hooks": ');
});

test('project scope references an in-project kit through $CLAUDE_PROJECT_DIR', () => {
  const project = makeProject({ kitInside: true });
  install(project, ['--scope=project', '--no-mcp']);
  const command = settingsOf(project.root, 'settings.json').hooks.PreToolUse[0].hooks[0].command;
  assert.equal(command, 'node "$CLAUDE_PROJECT_DIR/tools/kit/cli/hooks/entry.js" claude-pre-tool');
});

test('GAP-4: pre-commit hook and CI workflow are re-pinned to the launcher; a foreign hook is kept', () => {
  const project = makeProject();
  spawnSync('git', ['init', '-q'], { cwd: project.root });
  const hooksDir = path.join(project.root, '.git', 'hooks');
  fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\n# Chemical X Protocol: old\nnpx chemx audit\n');
  fs.mkdirSync(path.join(project.root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(project.root, '.github', 'workflows', 'chemx-audit.yml'), 'jobs:\n  a:\n    steps:\n      - name: Audit\n        run: npx --yes chemx audit --min-grade=B\n');
  install(project, ['--no-mcp']);
  const hook = fs.readFileSync(path.join(hooksDir, 'pre-commit'), 'utf-8');
  assert.match(hook, new RegExp(`PINNED_CLI='${path.join(project.kit, 'cli', 'index.js')}'`));
  assert.match(hook, /# chemx-pin: 1\.2\.3-4/);
  const workflow = fs.readFileSync(path.join(project.root, '.github', 'workflows', 'chemx-audit.yml'), 'utf-8');
  assert.match(workflow, /run: npx --yes chemx@1\.2\.3-4 audit --min-grade=B/);
  fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\nhusky run\n');
  const report = install(project, ['--no-mcp']);
  assert.equal(fs.readFileSync(path.join(hooksDir, 'pre-commit'), 'utf-8'), '#!/bin/sh\nhusky run\n');
  assert.equal(report.actions.find((action) => action.label === 'git pre-commit').status, 'refused');
});

test('GAP-4: templates pin the exact kit version by default instead of an unpinned npx chemx', () => {
  const version = readKitVersion();
  assert.match(buildGitHubWorkflowScript(), new RegExp(`run: npx --yes chemx@${version.replace(/\./g, '\\.')} audit`));
  assert.doesNotMatch(buildPreCommitHookScript(), /AUDIT_BIN="npx chemx"/);
});
