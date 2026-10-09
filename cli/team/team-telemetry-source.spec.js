/**
 * Telemetry attaches the right transcript or none (finding telemetry-wrong-transcript).
 * Only explicit tokens or an explicit --log transcript are recorded; nothing is guessed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openIndexDb } from '../search-schema.js';
import { createTask, claimTask, getTask } from './team-db-tasks.js';
import { registerAgent } from './team-db-agents.js';
import { completeTaskWithAudit } from './team-triage.js';
import { findTranscriptLog } from './team-telemetry.js';
import { runTeamCli } from './team-commands.js';

const CLI_DIR = fileURLToPath(new URL('..', import.meta.url));
const TRANSCRIPT = `${JSON.stringify({ tokens: { prompt: 294, completion: 88864 } })}\n`;

const makeProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-telemetry-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // A transcript that belongs to some other session: the old code attached it to every task.
  fs.mkdirSync(path.join(root, '.chemx', 'logs'), { recursive: true });
  fs.writeFileSync(path.join(root, '.chemx', 'logs', 'transcript.jsonl'), TRANSCRIPT);
  return { root, db: openIndexDb(root, { fresh: true }) };
};

const claimedTask = (db, agent) => {
  registerAgent(db, { id: agent, role: 'executor' });
  const task = createTask(db, { title: 'telemetry probe' });
  claimTask(db, task.id, agent);
  return task;
};

test('telemetry: without tokens or --log nothing is guessed and nothing is recorded', (t) => {
  const { root, db } = makeProject(t);
  const previousConversation = process.env.CONVERSATION_ID;
  delete process.env.CONVERSATION_ID;
  t.after(() => { if (previousConversation !== undefined) process.env.CONVERSATION_ID = previousConversation; });
  const task = claimedTask(db, '@quiet');

  const done = completeTaskWithAudit(db, task.id, '@quiet', { cwd: root, noTargetConfirm: true });
  assert.equal(done.status, 'done');
  assert.equal(done.result_payload.telemetry, null, 'unknown telemetry is null, not a stranger transcript');
  assert.equal(done.result_payload.conversationId, null, 'no hard-coded conversation id');
  assert.equal(getTask(db, task.id).total_tokens, 0);
  assert.equal(db.prepare("SELECT total_tokens FROM agents WHERE id = '@quiet'").get().total_tokens, 0);
  assert.equal(findTranscriptLog({ cwd: root }), null);
});

test('telemetry: an explicit --log transcript is parsed and labeled by source', (t) => {
  const { root, db } = makeProject(t);
  const task = claimedTask(db, '@logged');
  const logPath = path.join(root, '.chemx', 'logs', 'transcript.jsonl');

  const done = runTeamCli(['task', 'done', String(task.id), '--as=@logged', '--no-target-confirm', `--log=${logPath}`], false, root);
  assert.equal(done.result_payload.telemetry.source, 'log');
  assert.equal(done.result_payload.telemetry.completion_tokens, 88864);
});

test('telemetry: explicit tokens win and are labeled by source', (t) => {
  const { root, db } = makeProject(t);
  const task = claimedTask(db, '@counted');
  const done = completeTaskWithAudit(db, task.id, '@counted', { cwd: root, noTargetConfirm: true, tokens: { prompt: 10, completion: 5 } });
  assert.equal(done.result_payload.telemetry.source, 'tokens');
  assert.equal(getTask(db, task.id).total_tokens, 15);
});

test('telemetry: shipped code carries no hard-coded home paths or conversation ids', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      const isShippedJs = entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.spec.js');
      if (!isShippedJs) continue;
      const source = fs.readFileSync(full, 'utf-8');
      const hasHardCodedHome = /['"`]\/home\/[a-z]/.test(source) || source.includes('536da3e7-6be6-47b6-b308-58786d395e36');
      if (hasHardCodedHome) offenders.push(path.relative(CLI_DIR, full));
    }
  };
  walk(CLI_DIR);
  assert.deepEqual(offenders, []);
});
