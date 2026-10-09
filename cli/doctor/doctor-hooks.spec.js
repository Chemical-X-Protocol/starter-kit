// chemx doctor hook checks: missing, outdated (matcher or entry path differs from this chemx), the
// bootstrap guard (legacy unless it delegates to chemx) and the --fix scope. Temp projects only.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkHooks } from './check-host.js';
import { runDoctor } from './doctor-cli.js';
import { parseInstallArgs, runInstallHooks } from '../hooks/install-hooks-cli.js';
import { KIT_ROOT } from '../hooks/launcher.js';

const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const tempDir = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); created.push(dir); return dir; };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf-8'));
const install = (root, extra = []) => runInstallHooks(parseInstallArgs(['--host=claude', `--root=${root}`, '--no-statusline', ...extra], root));
const makeKit = () => {
  const kit = tempDir('chemx-doctor-other-kit-');
  fs.mkdirSync(path.join(kit, 'cli', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'package.json'), JSON.stringify({ version: '0.0.1' }));
  fs.writeFileSync(path.join(kit, 'cli', 'index.js'), '');
  return kit;
};

test('no chemx hooks at all: fails as missing and is fixable into the tracked project settings', () => {
  const root = tempDir('chemx-doctor-h1-');
  const check = checkHooks({ projectRoot: root });
  assert.equal(check.status, 'fail');
  assert.match(check.summary, /missing: PreToolUse, PostToolUse, SessionStart/);
  assert.deepEqual([check.fixable, check.scope], [true, 'project']);
});

test('hooks installed by this chemx pass; the same install from another kit is reported outdated', () => {
  const root = tempDir('chemx-doctor-h2-');
  install(root);
  assert.equal(checkHooks({ projectRoot: root }).status, 'pass');
  const other = tempDir('chemx-doctor-h3-');
  install(other, [`--kit=${makeKit()}`]);
  const check = checkHooks({ projectRoot: other });
  assert.equal(check.status, 'fail');
  assert.match(check.summary, /outdated in \.claude\/settings\.json \(differs from this chemx\): ~ PreToolUse: .*entry\.js" claude-pre-tool\s+=>\s+.*entry\.js" claude-pre-tool/);
});

test('an old matcher is reported outdated with the exact difference, and doctor --fix rewrites that scope', async () => {
  const root = tempDir('chemx-doctor-h4-');
  install(root, ['--scope=local']);
  const file = path.join(root, '.claude', 'settings.local.json');
  const settings = readJson(file);
  settings.hooks.PreToolUse[0].matcher = 'Bash|Grep';
  writeJson(file, settings);
  const check = checkHooks({ projectRoot: root });
  assert.match(check.summary, /outdated in \.claude\/settings\.local\.json.*Bash\|Grep -> .*=>.*Bash\|Grep\|Read\|Edit/);
  assert.equal(check.scope, 'local');
  const report = await runDoctor({ projectRoot: root, isFix: true, procRoot: tempDir('chemx-doctor-noproc-'), envPath: '' });
  assert.equal(report.checks.find((entry) => entry.id === 'hooks').status, 'pass');
  assert.equal(readJson(file).hooks.PreToolUse[0].matcher, 'Bash|Grep|Read|Edit|Write|MultiEdit|NotebookEdit|Glob');
  assert.equal(fs.existsSync(path.join(root, '.claude', 'settings.json')), false, 'project settings untouched');
});

test('the bootstrap guard is legacy unless the file hands calls to the chemx hook command', () => {
  const root = tempDir('chemx-doctor-h5-');
  install(root);
  const local = path.join(root, '.claude', 'settings.local.json');
  writeJson(local, { hooks: { PreToolUse: [{ matcher: 'Bash|Grep', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/chemx-guard.mjs"' }] }] } });
  assert.match(checkHooks({ projectRoot: root }).summary, /bootstrap chemx-guard\.mjs still installed/);
  fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'hooks', 'chemx-guard.mjs'), "spawnSync(process.execPath, [entry, 'claude-pre-tool'])\n");
  assert.equal(checkHooks({ projectRoot: root }).status, 'pass', 'a delegating bootstrap is the same implementation');
});

test('doctor itself reads the real kit: the installed entry path is this checkout', () => {
  const root = tempDir('chemx-doctor-h6-');
  const report = install(root);
  assert.match(readJson(path.join(root, '.claude', 'settings.json')).hooks.PreToolUse[0].hooks[0].command, new RegExp(path.join(KIT_ROOT, 'cli', 'hooks', 'entry.js').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(report.status, 'pass');
});
