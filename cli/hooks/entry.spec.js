// Specs for the hook entry's fail-safe path: the rule modules throw on import (task #2592).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { runEntry, fallbackPreTool, claimWindow, postGuardCrash, CRASH_WINDOW_MS } from './entry.js';

const tempDir = (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-entry-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const sink = () => {
  const out = { text: '' };
  const stream = new Writable({ write(chunk, _enc, cb) { out.text += chunk; cb(); } });
  return { out, stream };
};

const brokenModule = (t) => {
  const file = path.join(tempDir(t), 'guard-route.js');
  fs.writeFileSync(file, 'const source = 1;\nconst source = 2;\nexport default source;\n');
  return file;
};

const runBroken = async (t, payload, root) => {
  const file = brokenModule(t);
  const { out, stream } = sink();
  const code = await runEntry(['claude-pre-tool'], {
    stdin: Readable.from([Buffer.from(JSON.stringify(payload))]),
    stdout: stream,
    env: { CLAUDE_PROJECT_DIR: root, CHEMX_AGENT_ID: '@spec' },
    loader: () => import(file),
  });
  return { code, out: out.text };
};

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

test('the broken temp module really throws on import', async (t) => {
  await assert.rejects(import(brokenModule(t)), /already been declared/);
});

const DENIED = [
  ['sed -i s/a/b/ cli/hooks/guard-route.js', 'fallback-shell-write'],
  ['echo x > cli/team/team-route.js', 'fallback-shell-write'],
  ['git diff', 'fallback-git-read'],
  ['git log -n 3', 'fallback-git-read'],
  ['cat cli/hooks/entry.js', 'fallback-cat-source'],
  ['sed -n 1,20p cli/hooks/entry.js', 'fallback-sed-n'],
];

for (const [command, rule] of DENIED) {
  test(`fallback denies: ${command}`, async (t) => {
    const { code, out } = await runBroken(t, bash(command), tempDir(t));
    const parsed = JSON.parse(out);
    assert.equal(code, 0);
    assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(parsed.hookSpecificOutput.permissionDecisionReason, new RegExp(rule));
    assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /already been declared/);
  });
}

test('fallback denies native Edit on a repo file but not Write outside the repo', async (t) => {
  const root = tempDir(t);
  const inside = await runBroken(t, { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'a.js') } }, root);
  assert.equal(JSON.parse(inside.out).hookSpecificOutput.permissionDecision, 'deny');
  const outside = await runBroken(t, { tool_name: 'Write', tool_input: { file_path: path.join(os.tmpdir(), 'elsewhere.txt') } }, root);
  assert.equal(outside.out, '');
});

test('fallback allows ordinary commands and honors a bypass comment', async (t) => {
  const root = tempDir(t);
  assert.equal((await runBroken(t, bash('ls -la'), root)).out, '');
  assert.equal((await runBroken(t, bash('git diff # chemx-bypass: spec'), root)).out, '');
  assert.equal(fallbackPreTool(bash('echo hi >/dev/null'), {}, 'x'), null);
});

test('fallback fails open when the payload is not JSON', async (t) => {
  const file = brokenModule(t);
  const { out, stream } = sink();
  const code = await runEntry(['claude-pre-tool'], { stdin: Readable.from([Buffer.from('not json')]), stdout: stream, env: {}, loader: () => import(file) });
  assert.equal(code, 0);
  assert.equal(out.text, '');
});

test('crash marker is rate limited per root; no feed event without a db', async (t) => {
  const root = tempDir(t);
  const now = Date.now();
  assert.equal(claimWindow(root, now), true);
  assert.equal(claimWindow(root, now + 1), false);
  assert.equal(claimWindow(root, now + CRASH_WINDOW_MS + 1), true);
  assert.equal(await postGuardCrash({ root: tempDir(t), hookName: 'claude-pre-tool', loadError: 'boom' }), false);
});

test('normal path delegates to runHookCli when the module loads', async () => {
  const calls = [];
  const code = await runEntry(['x'], { loader: async () => ({ runHookCli: async (args) => { calls.push(args); return 0; } }) });
  assert.equal(code, 0);
  assert.deepEqual(calls, [['x']]);
});
