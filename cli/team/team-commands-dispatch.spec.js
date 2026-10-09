// chemx team dispatch CLI surface: capacity flags reach the planner and --help never plans.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { parseFlags } from './team-flags.js';
import { handleDispatchCommand } from './team-commands-dispatch.js';
import { DEFAULT_MAX_AGENTS, DEFAULT_MAX_TASKS_PER_AGENT } from './team-dispatch-batches.js';

const makeProject = (t, fileCount) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-dispatch-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.chemx'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  const now = Date.now();
  const insert = db.prepare('INSERT INTO agent_tasks (title, target_path, status, priority, rule_id, needs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < fileCount; i += 1) {
    const rel = `src/f${i}.js`;
    fs.writeFileSync(path.join(root, rel), 'export const x = 1;\n');
    insert.run(`Fix ${rel}`, rel, 'queued', 2, 'CONTROL_FLOW_INLINE_BOOLEAN', 'light', now, now);
  }
  return { root, db };
};

test('team flags: --max-agents and --per-agent set dispatch capacity', () => {
  const flags = parseFlags(['dispatch', '--max-agents=12', '--per-agent=5']);
  assert.equal(flags.maxAgents, 12);
  assert.equal(flags.maxTasksPerAgent, 5);
  assert.equal(parseFlags(['--max-tasks-per-agent=7']).maxTasksPerAgent, 7);
});

test('team dispatch: --help prints usage and plans nothing', () => {
  const result = handleDispatchCommand(null, { help: true }, false);
  assert.match(result.usage, /--max-agents/);
  assert.equal(result.plan, undefined);
});

test('team dispatch: capacity flags reach the planner', (t) => {
  const { root, db } = makeProject(t, 20);
  const byDefault = handleDispatchCommand(db, {}, false, root).plan;
  assert.equal(byDefault.totals.dispatched, DEFAULT_MAX_AGENTS * DEFAULT_MAX_TASKS_PER_AGENT);
  const widened = handleDispatchCommand(db, { maxAgents: 10, maxTasksPerAgent: 2 }, false, root).plan;
  assert.equal(widened.totals.dispatched, 20);
  assert.equal(widened.totals.agents, 10);
});
