import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOOKS } from './run-hook.js';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN = path.join(KIT, 'plugins', 'claude-code');
const LAUNCHER = path.join(PLUGIN, 'bin', 'chemx-launch.mjs');
const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const tempDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-plugin-')); created.push(dir); return dir; };
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf-8'));
const launch = (launcher, args, env, input = '') => spawnSync(process.execPath, [launcher, ...args], { input, env: { PATH: '', HOME: os.tmpdir(), ...env }, encoding: 'utf-8' });
const GIT_LOG = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git log -3' } });

test('plugin manifest, marketplace entry, hooks and MCP config are well formed', () => {
  const manifest = readJson(path.join(PLUGIN, '.claude-plugin', 'plugin.json'));
  assert.equal(manifest.name, 'chemx');
  const marketplace = readJson(path.join(KIT, '.claude-plugin', 'marketplace.json'));
  assert.equal(path.resolve(KIT, marketplace.plugins[0].source), PLUGIN);
  const { hooks } = readJson(path.join(PLUGIN, 'hooks', 'hooks.json'));
  const commands = Object.values(hooks).flat().flatMap((group) => group.hooks.map((hook) => hook.command));
  assert.equal(commands.length, 3);
  for (const command of commands) {
    const [, name] = command.match(/chemx-launch\.mjs" hook ([\w-]+)$/) ?? [];
    assert.ok(Object.hasOwn(HOOKS, name ?? ''), command);
  }
  const server = readJson(path.join(PLUGIN, '.mcp.json')).mcpServers['chemical-x'];
  assert.deepEqual(server.args, ['${CLAUDE_PLUGIN_ROOT}/bin/chemx-launch.mjs', 'mcp']);
  const skill = fs.readFileSync(path.join(PLUGIN, 'skills', 'chemx', 'SKILL.md'), 'utf-8');
  assert.match(skill, /^---\nname: chemx\ndescription: .+\n---\n/);
  assert.ok(skill.split('\n').length < 40, 'the skill stays short');
});

test('launcher runs the kit hook in-process when CHEMX_KIT names the kit', () => {
  const result = launch(LAUNCHER, ['hook', 'claude-pre-tool'], { CHEMX_KIT: KIT, CHEMX_FRICTION_LOG: path.join(tempDir(), 'f.jsonl') }, GIT_LOG);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('launcher finds the kit in the project node_modules', () => {
  const project = tempDir();
  fs.mkdirSync(path.join(project, 'node_modules', '@chemx'), { recursive: true });
  fs.symlinkSync(KIT, path.join(project, 'node_modules', '@chemx', 'starter-kit'));
  const copy = path.join(tempDir(), 'chemx-launch.mjs');
  fs.copyFileSync(LAUNCHER, copy);
  const result = launch(copy, ['hook', 'claude-pre-tool'], { CLAUDE_PROJECT_DIR: project, CHEMX_FRICTION_LOG: path.join(project, 'f.jsonl') }, GIT_LOG);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('with no kit anywhere, hooks fail open silently and mcp exits 1 with a hint', () => {
  const pluginCopy = path.join(tempDir(), 'plugin', 'bin');
  fs.mkdirSync(pluginCopy, { recursive: true });
  const copy = path.join(pluginCopy, 'chemx-launch.mjs');
  fs.copyFileSync(LAUNCHER, copy);
  const env = { CLAUDE_PROJECT_DIR: tempDir() };
  const hook = launch(copy, ['hook', 'claude-pre-tool'], env, GIT_LOG);
  assert.deepEqual([hook.status, hook.stdout], [0, '']);
  const mcp = launch(copy, ['mcp'], env);
  assert.equal(mcp.status, 1);
  assert.match(mcp.stderr, /no chemx kit found/);
});
