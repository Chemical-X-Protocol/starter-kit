import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import {
  registerAgent,
  updateAgentHeartbeat,
  getAgent,
  listAgents
} from './team-db-agents.js';
import {
  createTask,
  claimTask,
  updateTaskStatus,
  listTasks,
  areTaskDependenciesMet,
  getTask
} from './team-db-tasks.js';
import {
  postFeedEvent,
  queryFeed
} from './team-db-feed.js';
import {
  requestFileLock,
  releaseFileLock,
  getFileLockStatus,
  cleanExpiredLeases
} from './team-db-locks.js';
import {
  getSwarmStatus
} from './team-db.js';
import {
  queryUnassignedHazards,
  autoGenerateTasksFromAudit,
  completeTaskWithAudit
} from './team-triage.js';
import { runTeamCli } from './team-commands.js';
import { openIndexDb } from '../search-db.js';
import { executeMcpTool } from '../mcp/tools.js';
import { parseTranscriptFile, ingestTaskTelemetry } from './team-telemetry.js';

const setupTestDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      tier TEXT NOT NULL,
      lines INTEGER NOT NULL,
      chars INTEGER NOT NULL,
      health_score INTEGER NOT NULL DEFAULT 100,
      hazard_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      rule TEXT NOT NULL,
      severity TEXT NOT NULL,
      pillar TEXT NOT NULL,
      line INTEGER NOT NULL DEFAULT 1,
      hazard TEXT NOT NULL,
      directive TEXT NOT NULL
    );
  `);
  initTeamSchema(db);
  return db;
};

test('team-schema: creates all swarm tables and indexes cleanly', () => {
  const db = setupTestDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
  assert.ok(tables.includes('agents'));
  assert.ok(tables.includes('agent_tasks'));
  assert.ok(tables.includes('agent_feed'));
  assert.ok(tables.includes('file_leases'));
  assert.ok(tables.includes('file_lock_queue'));
});

test('team-db-agents: registers agents and updates heartbeats', () => {
  const db = setupTestDb();
  const agent = registerAgent(db, {
    id: 'coder-alpha',
    name: 'Alpha Coder',
    role: 'specialist',
    capabilities: ['react', 'molecular']
  });

  assert.strictEqual(agent.id, '@coder-alpha');
  assert.strictEqual(agent.role, 'specialist');
  assert.strictEqual(agent.status, 'idle');
  assert.deepStrictEqual(agent.capabilities, ['react', 'molecular']);

  updateAgentHeartbeat(db, '@coder-alpha', 'busy', 42);
  const updated = getAgent(db, '@coder-alpha');
  assert.strictEqual(updated.status, 'busy');
  assert.strictEqual(updated.current_task_id, 42);

  const agents = listAgents(db);
  assert.strictEqual(agents.length, 1);
});

test('team-db-tasks: manages task DAG and dependency checks', () => {
  const db = setupTestDb();
  registerAgent(db, { id: 'worker-1', name: 'Worker One', role: 'coder' });

  const parent = createTask(db, { title: 'Design Component Schema', priority: 1 });
  assert.strictEqual(parent.status, 'queued');

  const child = createTask(db, {
    title: 'Implement Component View',
    dependencies: [parent.id],
    priority: 2
  });

  // Dependencies not met yet
  assert.strictEqual(areTaskDependenciesMet(db, child.id), false);
  const earlyClaim = claimTask(db, child.id, '@worker-1');
  assert.strictEqual(earlyClaim.success, false);
  assert.strictEqual(earlyClaim.reason, 'dependencies_unmet');

  // Complete parent task
  updateTaskStatus(db, parent.id, 'done');
  assert.strictEqual(areTaskDependenciesMet(db, child.id), true);

  // Now claim succeeds
  const claimRes = claimTask(db, child.id, '@worker-1');
  assert.strictEqual(claimRes.success, true);
  assert.strictEqual(claimRes.task.status, 'in_progress');
  assert.strictEqual(claimRes.task.assigned_agent_id, '@worker-1');
});

test('team-db-feed: handles timeline, @mentions, and cursor-based since_id queries', () => {
  const db = setupTestDb();
  const e1 = postFeedEvent(db, { author_id: '@lead', message: 'Swarm initialized' });
  const e2 = postFeedEvent(db, { author_id: '@coder-1', recipient_id: '@lead', message: 'Ready for tasks' });
  const e3 = postFeedEvent(db, { author_id: '@lead', thread_id: e2.id, message: 'Assigning task #1' });

  const allFeed = queryFeed(db);
  assert.strictEqual(allFeed.length, 3);

  // Cursor query: since_id = e1.id returns only e2 and e3
  const delta = queryFeed(db, { since_id: e1.id });
  assert.strictEqual(delta.length, 2);
  assert.strictEqual(delta[0].id, e2.id);

  // Scoped mentions: coder-2 sees public broadcasts (e1, e3), but NOT private direct message e2
  const coder2Feed = queryFeed(db, { agent_id: '@coder-2' });
  assert.strictEqual(coder2Feed.length, 2);
  assert.ok(!coder2Feed.some((e) => e.id === e2.id));
});

test('team-db-locks: enforces FIFO lock queue and reactive auto-promotion on unlock', () => {
  const db = setupTestDb();

  // Agent 1 requests lock: granted immediately
  const l1 = requestFileLock(db, 'src/atoms/Button.tsx', '@agent-1', { purpose: 'Add variant' });
  assert.strictEqual(l1.granted, true);
  assert.strictEqual(l1.lease.locked_by, '@agent-1');

  // Agent 2 requests lock: queued at position 1
  const l2 = requestFileLock(db, 'src/atoms/Button.tsx', '@agent-2', { purpose: 'Style update' });
  assert.strictEqual(l2.granted, false);
  assert.strictEqual(l2.queued, true);
  assert.strictEqual(l2.position, 1);

  // Agent 3 requests lock: queued at position 2
  const l3 = requestFileLock(db, 'src/atoms/Button.tsx', '@agent-3', { purpose: 'Test pass' });
  assert.strictEqual(l3.granted, false);
  assert.strictEqual(l3.queued, true);
  assert.strictEqual(l3.position, 2);

  const statusBefore = getFileLockStatus(db, 'src/atoms/Button.tsx');
  assert.strictEqual(statusBefore.lease.locked_by, '@agent-1');
  assert.strictEqual(statusBefore.waiters.length, 2);

  // Agent 1 releases lock: Agent 2 is automatically promoted to active lease!
  const releaseRes = releaseFileLock(db, 'src/atoms/Button.tsx', '@agent-1');
  assert.strictEqual(releaseRes.success, true);
  assert.strictEqual(releaseRes.promotedWaiter, '@agent-2');

  // Verify Agent 2 now holds the lease, Agent 3 is remaining in queue
  const statusAfter = getFileLockStatus(db, 'src/atoms/Button.tsx');
  assert.strictEqual(statusAfter.lease.locked_by, '@agent-2');
  assert.strictEqual(statusAfter.waiters.length, 1);
  assert.strictEqual(statusAfter.waiters[0].agent_id, '@agent-3');

  // Feed received lock_granted event for Agent 2
  const grantedEvents = queryFeed(db, { event_type: 'lock_granted' });
  assert.strictEqual(grantedEvents.length, 1);
  assert.strictEqual(grantedEvents[0].recipient_id, '@agent-2');
});

test('team-triage: cross-queries codebase hazards and generates tasks', () => {
  const db = setupTestDb();
  db.prepare(`
    INSERT INTO files (path, mtime, size, tier, lines, chars, health_score, hazard_count)
    VALUES ('src/molecules/BigMonolith.tsx', 1000, 5000, 'molecule', 250, 8000, 55, 4)
  `).run();

  db.prepare(`
    INSERT INTO violations (file_path, rule, severity, pillar, line, hazard, directive)
    VALUES ('src/molecules/BigMonolith.tsx', 'LINE_LIMIT', 'CRITICAL', 'MOLECULAR', 1, 'Exceeds line limit', 'Decompose')
  `).run();

  const hazards = queryUnassignedHazards(db);
  assert.strictEqual(hazards.length, 1);
  assert.strictEqual(hazards[0].path, 'src/molecules/BigMonolith.tsx');

  const generated = autoGenerateTasksFromAudit(db);
  assert.strictEqual(generated.length, 1);
  assert.strictEqual(generated[0].target_path, 'src/molecules/BigMonolith.tsx');

  // Now that a task exists, it won't be returned again
  const hazardsAfter = queryUnassignedHazards(db);
  assert.strictEqual(hazardsAfter.length, 0);

  // Complete task with audit attestation
  const completed = completeTaskWithAudit(db, generated[0].id, '@refactor-bot');
  assert.strictEqual(completed.status, 'done');
  assert.strictEqual(completed.result_payload.completedBy, '@refactor-bot');
});

test('team-db: getSwarmStatus compiles complete control panel overview', () => {
  const db = setupTestDb();
  registerAgent(db, { id: 'agent-a', role: 'coder' });
  createTask(db, { title: 'Fix CSS' });
  requestFileLock(db, 'src/theme.scss', '@agent-a');

  const status = getSwarmStatus(db);
  assert.strictEqual(status.agents.total, 1);
  assert.strictEqual(status.tasks.queued, 1);
  assert.strictEqual(status.locks.active, 1);
});

test('mcp-tools: executes team MCP tools with columnar outputs', async () => {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-team-mcp-'));
  try {
    const statusRes = await executeMcpTool('chemx_team_status', {}, tmpCwd);
    assert.ok(statusRes.agents);
    assert.ok(statusRes.tasks);
    assert.ok(statusRes.locks.leases.cols);

    const postRes = await executeMcpTool('chemx_team_post', {
      authorId: '@test-bot',
      message: 'Hello Swarm'
    }, tmpCwd);
    assert.ok(postRes.id);

    const feedRes = await executeMcpTool('chemx_team_feed', { limit: 5 }, tmpCwd);
    assert.ok(feedRes.cols);
    assert.ok(Array.isArray(feedRes.rows));

    const lockRes = await executeMcpTool('chemx_team_lock', {
      action: 'acquire',
      filePath: 'src/test-lock.ts',
      agentId: '@test-bot'
    }, tmpCwd);
    assert.strictEqual(lockRes.granted, true);

    await executeMcpTool('chemx_team_lock', {
      action: 'release',
      filePath: 'src/test-lock.ts',
      agentId: '@test-bot'
    }, tmpCwd);
  } finally {
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  }
});

test('team-schema: ensures telemetry columns exist on agent_tasks and agents', () => {
  const db = setupTestDb();
  const taskCols = db.prepare('PRAGMA table_info(agent_tasks)').all().map((c) => c.name);
  assert.ok(taskCols.includes('prompt_tokens'));
  assert.ok(taskCols.includes('completion_tokens'));
  assert.ok(taskCols.includes('cached_tokens'));
  assert.ok(taskCols.includes('total_tokens'));
  assert.ok(taskCols.includes('cost_usd'));

  const agentCols = db.prepare('PRAGMA table_info(agents)').all().map((c) => c.name);
  assert.ok(agentCols.includes('total_prompt_tokens'));
  assert.ok(agentCols.includes('total_completion_tokens'));
  assert.ok(agentCols.includes('total_tokens'));
  assert.ok(agentCols.includes('total_cost_usd'));
});

test('team-telemetry: parses transcript JSONL files accurately', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-telemetry-test-'));
  const logFile = path.join(tmpDir, 'transcript.jsonl');
  try {
    const lines = [
      JSON.stringify({ source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Please refactor this file' }),
      JSON.stringify({ source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Sure, I will decompose the monolith' }),
      JSON.stringify({ source: 'MODEL', type: 'GENERIC', tokens: { prompt: 100, completion: 50, cached: 20 } })
    ];
    fs.writeFileSync(logFile, lines.join('\n') + '\n');
    const stats = parseTranscriptFile(logFile);
    assert.ok(stats.promptTokens > 0);
    assert.ok(stats.completionTokens > 0);
    assert.strictEqual(stats.cachedTokens, 20);
    assert.strictEqual(stats.totalTokens, stats.promptTokens + stats.completionTokens);
    assert.ok(stats.costUsd > 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('team-telemetry: ingests token metrics into SQLite during completeTaskWithAudit', () => {
  const db = setupTestDb();
  registerAgent(db, { id: 'telemetry-coder', role: 'coder' });
  const task = createTask(db, { title: 'Add Telemetry' });

  const completed = completeTaskWithAudit(db, task.id, '@telemetry-coder', {
    tokens: { prompt: 500, completion: 200, cached: 50, cost_usd: 0.00325 }
  });

  assert.strictEqual(completed.status, 'done');
  assert.ok(completed.result_payload.telemetry);
  assert.strictEqual(completed.result_payload.telemetry.prompt_tokens, 500);
  assert.strictEqual(completed.result_payload.telemetry.completion_tokens, 200);

  const updatedTask = getTask(db, task.id);
  assert.strictEqual(updatedTask.prompt_tokens, 500);
  assert.strictEqual(updatedTask.completion_tokens, 200);
  assert.strictEqual(updatedTask.cached_tokens, 50);
  assert.strictEqual(updatedTask.total_tokens, 700);
  assert.strictEqual(updatedTask.cost_usd, 0.00325);

  const agent = getAgent(db, '@telemetry-coder');
  assert.strictEqual(agent.total_prompt_tokens, 500);
  assert.strictEqual(agent.total_completion_tokens, 200);
  assert.strictEqual(agent.total_tokens, 700);
  assert.strictEqual(agent.total_cost_usd, 0.00325);

  const swarmStatus = getSwarmStatus(db);
  assert.ok(swarmStatus.tokens);
  assert.strictEqual(swarmStatus.tokens.prompt, 500);
  assert.strictEqual(swarmStatus.tokens.completion, 200);
  assert.strictEqual(swarmStatus.tokens.total, 700);
  assert.strictEqual(swarmStatus.tokens.cost_usd, 0.00325);
});

test('team-commands: runTeamCli handles task triage, add alias, and agent auto-registration', () => {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-team-cli-test-'));
  try {
    const db = openIndexDb(tmpCwd);
    assert.ok(db, 'Database should be created');

    // Test empty list output
    const emptyList = runTeamCli(['task', 'list'], false, tmpCwd);
    assert.deepStrictEqual(emptyList, []);

    // Test task add alias
    const created = runTeamCli(['task', 'add', 'Fix', 'architectural', 'monolith', '--as=@architect', '--prio=1'], false, tmpCwd);
    assert.ok(created);
    assert.strictEqual(created.id, 1);
    assert.strictEqual(created.title, 'Fix architectural monolith');
    assert.strictEqual(created.priority, 1);

    // Verify agent was registered automatically
    const agent = getAgent(db, '@architect');
    assert.ok(agent, 'Author agent should be registered in agents table');
    assert.strictEqual(agent.role, 'contributor');

    // Verify task_created event was posted to agent_feed
    const feed = queryFeed(db, { task_id: 1 });
    assert.strictEqual(feed.length, 1);
    assert.strictEqual(feed[0].author_id, '@architect');
    assert.strictEqual(feed[0].event_type, 'task_created');

    // Seed a violation into violations table without pre-populating files table
    db.prepare(`
      INSERT INTO violations (file_path, rule, severity, pillar, line, hazard, directive)
      VALUES ('src/components/BrokenCard.tsx', 'NO_RAW_DOM', 'HIGH', 'FOUNDATIONS', 14, 'Raw button used', 'Wrap in AtomButton')
    `).run();

    // Test task triage command: should pick up unassigned hazard and generate task
    const triaged = runTeamCli(['task', 'triage'], false, tmpCwd);
    assert.ok(Array.isArray(triaged));
    assert.strictEqual(triaged.length, 1);
    assert.strictEqual(triaged[0].target_path, 'src/components/BrokenCard.tsx');

    // Verify triage bot registered in agents table
    const triageBot = getAgent(db, '@triage-bot');
    assert.ok(triageBot, 'Triage bot should be registered in agents table');

    // Verify triage feed event
    const triageFeed = queryFeed(db, { event_type: 'triage_generated' });
    assert.strictEqual(triageFeed.length, 1);

    // Test task list now shows both tasks
    const allTasks = runTeamCli(['task', 'list'], false, tmpCwd);
    assert.strictEqual(allTasks.length, 2);
  } finally {
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  }
});

test('mcp-tools: chemx_team_task supports action triage and add with agent auto-registration', async () => {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-mcp-team-test-'));
  try {
    const db = openIndexDb(tmpCwd);
    assert.ok(db);

    // Create task via MCP
    const created = await executeMcpTool('chemx_team_task', {
      action: 'add',
      title: 'Decompose Search Monolith',
      agentId: '@planner-bot',
      priority: 1
    }, tmpCwd);
    assert.ok(created);
    assert.strictEqual(created.title, 'Decompose Search Monolith');

    // Verify agent auto-registered
    const agent = getAgent(db, '@planner-bot');
    assert.ok(agent);

    // Seed violation
    db.prepare(`
      INSERT INTO violations (file_path, rule, severity, pillar, line, hazard, directive)
      VALUES ('src/views/HugeView.tsx', 'LINE_LIMIT', 'CRITICAL', 'MOLECULAR', 1, 'Exceeds line limit', 'Decompose')
    `).run();

    // Triage via MCP
    const triaged = await executeMcpTool('chemx_team_task', {
      action: 'triage'
    }, tmpCwd);
    assert.ok(Array.isArray(triaged));
    assert.strictEqual(triaged.length, 1);
    assert.strictEqual(triaged[0].target_path, 'src/views/HugeView.tsx');

    // List via MCP
    const listRes = await executeMcpTool('chemx_team_task', {
      action: 'list'
    }, tmpCwd);
    assert.strictEqual(listRes.total, 2);
    assert.strictEqual(listRes.rows.length, 2);
  } finally {
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  }
});

