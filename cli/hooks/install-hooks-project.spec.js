// install-hooks on the default (tracked project) scope: preservation, idempotence, the change report,
// dry runs and --native-file-tools. Temp projects and temp kits only.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseInstallArgs, runInstallHooks, runInstallHooksCli } from './install-hooks-cli.js';

const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });

const makeProject = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-install-p-'));
  const kit = path.join(root, 'tools', 'kit');
  created.push(root);
  fs.mkdirSync(path.join(kit, 'cli', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'package.json'), JSON.stringify({ version: '1.2.3-4' }));
  fs.writeFileSync(path.join(kit, 'cli', 'index.js'), '');
  return { root, kit };
};
const argsFor = ({ root, kit }, extra) => ['--host=claude', `--root=${root}`, `--kit=${kit}`, ...extra];
const install = (project, extra = []) => runInstallHooks(parseInstallArgs(argsFor(project, extra), project.root));
const installText = async (project, extra = []) => {
  let text = '';
  const stdout = { write: (chunk) => { text += chunk; } };
  await runInstallHooksCli(argsFor(project, extra), { stdout, cwd: project.root });
  return text;
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf-8'));
const trackedFile = (root) => path.join(root, '.claude', 'settings.json');
const configAction = (report) => report.actions.find((action) => action.label === 'chemx config');

test('the default scope is the tracked .claude/settings.json; --scope=local is the untracked file', () => {
  const project = makeProject();
  assert.equal(parseInstallArgs(['--host=claude'], project.root).scope, 'project');
  install(project);
  assert.equal(fs.existsSync(trackedFile(project.root)), true);
  assert.equal(fs.existsSync(path.join(project.root, '.claude', 'settings.local.json')), false);
  install(project, ['--scope=local']);
  assert.equal(fs.existsSync(path.join(project.root, '.claude', 'settings.local.json')), true);
});

test('project settings keep every existing key and foreign hook; a second run changes nothing', () => {
  const project = makeProject();
  const foreign = { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-audit-logger' }] };
  const existing = { permissions: { allow: ['Bash(ls)'], deny: [] }, env: { A: '1' }, hooks: { PreToolUse: [foreign], Stop: [foreign] }, model: 'opus' };
  fs.mkdirSync(path.join(project.root, '.claude'));
  fs.writeFileSync(trackedFile(project.root), JSON.stringify(existing, null, 2));
  install(project);
  const settings = readJson(trackedFile(project.root));
  assert.deepEqual([settings.permissions, settings.env, settings.model, settings.hooks.Stop], [existing.permissions, existing.env, 'opus', [foreign]]);
  assert.deepEqual(settings.hooks.PreToolUse[0], foreign, 'foreign entry first and untouched');
  const bytes = fs.readFileSync(trackedFile(project.root), 'utf-8');
  const again = install(project);
  assert.deepEqual(again.actions.map((action) => action.status), ['unchanged']);
  assert.equal(fs.readFileSync(trackedFile(project.root), 'utf-8'), bytes);
});

test('the report lists exactly what changed: additions, replacements, nothing on a repeat', async () => {
  const project = makeProject();
  const first = await installText(project, ['--no-statusline']);
  assert.match(first, /\+ PreToolUse: Bash\|Grep\|Read\|Edit\|Write\|MultiEdit\|NotebookEdit\|Glob\|Agent\|Workflow -> node "\$CLAUDE_PROJECT_DIR\/tools\/kit\/cli\/hooks\/entry\.js" claude-pre-tool/);
  assert.match(first, /\+ PostToolUse: /);
  assert.match(first, /\+ SessionStart: /);
  const stale = { hooks: { PreToolUse: [{ matcher: 'Bash|Grep', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/chemx-guard.mjs"' }] }] } };
  fs.writeFileSync(trackedFile(project.root), JSON.stringify(stale));
  const replaced = await installText(project, ['--no-statusline']);
  assert.match(replaced, /~ PreToolUse: Bash\|Grep -> node "\$CLAUDE_PROJECT_DIR\/\.claude\/hooks\/chemx-guard\.mjs"\s+=>\s+Bash\|Grep\|Read/);
  assert.match(replaced, /backup: /);
  const repeat = await installText(project, ['--no-statusline']);
  assert.doesNotMatch(repeat, /^\s+[+~] /m);
  assert.match(repeat, /unchanged/);
});

test('--dry-run prints the plan and writes nothing', async () => {
  const project = makeProject();
  const text = await installText(project, ['--dry-run']);
  assert.match(text, /dry run/);
  assert.match(text, /\[dry run: not written\]/);
  assert.equal(fs.existsSync(path.join(project.root, '.claude')), false);
});

test('--native-file-tools records the policy: new .chemxrc, merged keys, comments refused, bad mode rejected', () => {
  const project = makeProject();
  const rc = path.join(project.root, '.chemxrc');
  assert.equal(configAction(install(project, ['--native-file-tools=block'])).status, 'create');
  assert.deepEqual(readJson(rc), { nativeFileTools: 'block' });
  fs.writeFileSync(rc, JSON.stringify({ profile: 'strict', nativeFileTools: 'warn' }));
  const merged = configAction(install(project, ['--native-file-tools=block']));
  assert.deepEqual(readJson(rc), { profile: 'strict', nativeFileTools: 'block' });
  assert.match(merged.notes[0], /~ nativeFileTools: block \(was "warn"\)/);
  assert.equal(configAction(install(project, ['--native-file-tools=block'])).status, 'unchanged');
  const commented = '// keep me\n{ "profile": "strict" }\n';
  fs.writeFileSync(rc, commented);
  assert.equal(configAction(install(project, ['--native-file-tools=block'])).status, 'refused');
  assert.equal(fs.readFileSync(rc, 'utf-8'), commented);
  assert.deepEqual(parseInstallArgs(['--host=claude', '--native-file-tools=maybe'], project.root).errors, ['--native-file-tools must be block, warn or allow']);
});
