/**
 * #4490: a command the chemx guard or policy denied is a blocked attempt, not a bypass.
 * Fixture: a denied heredoc redirect, a denied native Read and an allowed (ran) redirect, paired by tool_use id.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRun } from './usage-reader.js';
import { loadPricing } from './usage-pricing.js';
import { auditRun } from './audit-run.js';
import { isGuardDenial } from './audit-run-bypass.js';

delete process.env.CHEMX_PROJECT_ROOT;

const BASE = Date.UTC(2026, 9, 9, 12, 0, 0);
const MODEL = 'claude-haiku-5-5';
const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

const entry = (type, at, repo, message) => JSON.stringify({ type, timestamp: new Date(at).toISOString(), cwd: repo, uuid: `${type}-${at}`, message });
const use = (at, repo, id, name, input) => entry('assistant', at, repo, { id: `m${at}`, model: MODEL, content: [{ type: 'tool_use', id, name, input }], usage: USAGE });
const result = (at, repo, id, text) => entry('user', at, repo, { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: text }] });

const GUARD = 'PreToolUse:Bash hook error: chemx guard: `cat > x` must go through chemx. Use: chemx write.';
const POLICY = 'PreToolUse:Read hook error: chemx policy (nativeFileTools=block)';

test('guard and policy denials are blocked attempts; the allowed redirect is the only bypass', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-audit-denied-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, '.chemx'), { recursive: true });
  const dir = path.join(root, 'projects', 'proj', 'session', 'subagents', 'workflows', 'wf_denied');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'journal.jsonl'), `${JSON.stringify({ type: 'started', agentId: 'a1', label: 'fix:x', phase: 'Fix' })}\n`);
  const lines = [
    entry('user', BASE, repo, { role: 'user', content: [{ type: 'text', text: 'task' }] }),
    use(BASE + 1000, repo, 't1', 'Bash', { command: "cat > cli/denied.js <<'EOF'\nx\nEOF" }),
    result(BASE + 1100, repo, 't1', GUARD),
    use(BASE + 2000, repo, 't2', 'Read', { file_path: path.join(repo, 'cli', 'b.js') }),
    result(BASE + 2100, repo, 't2', POLICY),
    use(BASE + 3000, repo, 't3', 'Bash', { command: 'echo hi > cli/ran.js' }),
    entry('user', BASE + 3100, repo, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't3', content: [{ type: 'text', text: '' }] }] })
  ];
  fs.writeFileSync(path.join(dir, 'agent-a1.jsonl'), `${lines.join('\n')}\n`);
  const report = auditRun(readRun('wf_denied', path.join(root, 'projects')), { db: null, home: path.join(root, 'home'), pricing: loadPricing(root) });
  assert.equal(report.bypasses.shell.length, 1);
  assert.equal(report.bypasses.shell[0].target, path.join(repo, 'cli', 'ran.js'));
  assert.equal(report.bypasses.native.length, 0);
  assert.equal(report.bypasses.blocked.length, 2);
  assert.match(report.bypasses.blocked.map((b) => b.command).join('\n'), /cat > cli\/denied\.js/);
});

test('isGuardDenial recognises only chemx guard and policy denials', () => {
  assert.equal(isGuardDenial(GUARD), true);
  assert.equal(isGuardDenial(POLICY), true);
  assert.equal(isGuardDenial('some other hook error: file missing'), false);
  assert.equal(isGuardDenial(''), false);
});
