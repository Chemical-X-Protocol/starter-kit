import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { UI_STYLES } from './ui-styles.js';
import {
  STANDARD_CATEGORIES,
  getForumCategories,
  resolveAgentMeta,
  formatTokenStamp,
  updateAgentSignatureInDb
} from './ui-forum-data.js';
import { handleSwarmStatus, handleUpdateSignature } from './ui-handlers.js';
import { routeGet, routePost } from './ui-server-routes.js';
import { VIEW_FORUM_TEMPLATE } from './ui-template-forum.js';
import { VIEW_TOPIC_THREAD_TEMPLATE } from './ui-template-thread.js';
import { VIEW_KANBAN_TEMPLATE } from './ui-template-kanban.js';
import { VIEW_AGENTS_TEMPLATE, AGENT_MODAL_TEMPLATE } from './ui-template-agents.js';
import { UI_TEMPLATE } from './ui-template.js';

const setupTestDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, size INTEGER NOT NULL,
      tier TEXT NOT NULL, lines INTEGER NOT NULL, chars INTEGER NOT NULL,
      health_score INTEGER NOT NULL DEFAULT 100, hazard_count INTEGER NOT NULL DEFAULT 0
    );
  `);
  initTeamSchema(db);
  return db;
};

test('ui-styles: adheres to authentic early-2000s vBulletin aesthetics', () => {
  assert.ok(UI_STYLES.includes('Tahoma, Verdana, Arial, sans-serif'));
  assert.ok(UI_STYLES.includes('linear-gradient(180deg, #294e79 0%, #1e385b 100%)'));
  assert.ok(UI_STYLES.includes('border: 1px outset #294e79') || UI_STYLES.includes('outset'));
  assert.ok(UI_STYLES.includes('border: 1px inset #0c1524') || UI_STYLES.includes('inset'));
  assert.ok(UI_STYLES.includes('.vb-row-alt1'));
  assert.ok(UI_STYLES.includes('.vb-row-alt2'));
  assert.ok(UI_STYLES.includes('.vb-postbit'));
  assert.ok(UI_STYLES.includes('width: 160px'));
  assert.ok(UI_STYLES.includes('.vb-token-stamp'));
  assert.ok(UI_STYLES.includes('.vb-sig-divider'));
  assert.ok(UI_STYLES.includes('.vb-signature'));
  assert.ok(UI_STYLES.includes('.vb-beacon'));
});

test('ui-forum-data: getForumCategories returns 5 standard forum categories with metrics', () => {
  const db = setupTestDb();
  const now = Date.now();
  db.prepare("INSERT INTO agents (id, name, role, heartbeat) VALUES ('@orchestrator', 'Orchestrator', 'coordinator', ?)").run(now);
  db.prepare("INSERT INTO agent_feed (timestamp, author_id, event_type, message) VALUES (?, '@orchestrator', 'broadcast', 'Milestone M2 Launched')").run(now);
  db.prepare("INSERT INTO agent_tasks (title, tier, status, priority, created_at, updated_at) VALUES ('Directives Task', 'views', 'in_progress', 1, ?, ?)").run(now, now);
  db.prepare("INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose) VALUES ('cli/ui-styles.js', '@worker_m2', ?, ?, 'styling')").run(now, now + 60000);

  const categories = getForumCategories(db);
  assert.strictEqual(categories.length, 5);

  const names = categories.map((c) => c.name);
  assert.ok(names.includes('Announcements'));
  assert.ok(names.includes('Active Swarm Directives'));
  assert.ok(names.includes('War Room'));
  assert.ok(names.includes('Lock Registry'));
  assert.ok(names.includes('General Chat'));

  for (const cat of categories) {
    assert.ok(typeof cat.threadsCount === 'number');
    assert.ok(typeof cat.postsCount === 'number');
    assert.ok(typeof cat.lastPostTimestamp === 'number');
    assert.ok(typeof cat.authorBadge === 'string');
  }

  const ann = categories.find((c) => c.id === 'announcements');
  assert.ok(ann.postsCount >= 1);
  const dir = categories.find((c) => c.id === 'directives');
  assert.ok(dir.threadsCount >= 1);
  const lock = categories.find((c) => c.id === 'locks');
  assert.strictEqual(lock.threadsCount, 1);
});

test('ui-forum-data: token stamp formatting strictly enforces 4 decimal places', () => {
  const stamp = formatTokenStamp(120, 400);
  assert.ok(stamp.startsWith('[P: 400 | C: 30 | Cost: $'));
  const match = stamp.match(/Cost: \$(\d+\.\d+)/);
  assert.ok(match, 'Must contain cost formatted as currency');
  const decimals = match[1].split('.')[1];
  assert.strictEqual(decimals.length, 4, 'Cost must be formatted to exactly 4 decimal places');
});

test('ui-forum-data: agent meta resolution and signature customization in database', () => {
  const db = setupTestDb();
  const now = Date.now();
  db.prepare("INSERT INTO agents (id, name, role, heartbeat, metadata) VALUES ('@worker_m2', 'Worker M2', 'specialist', ?, ?)").run(
    now, JSON.stringify({ model: 'Claude 3.5 Sonnet', signature: 'Original Signature' })
  );

  const rawAgent = db.prepare("SELECT * FROM agents WHERE id = '@worker_m2'").get();
  const meta = resolveAgentMeta(rawAgent);
  assert.strictEqual(meta.id, '@worker_m2');
  assert.strictEqual(meta.model, 'Claude 3.5 Sonnet');
  assert.strictEqual(meta.signature, 'Original Signature');
  assert.strictEqual(meta.statusBeacon, 'idle');
  assert.strictEqual(meta.joinDate, 'Sep 2026');

  const updateRes = updateAgentSignatureInDb(db, '@worker_m2', 'Custom vBulletin Sig // Molecular');
  assert.strictEqual(updateRes, true);

  const updatedRaw = db.prepare("SELECT * FROM agents WHERE id = '@worker_m2'").get();
  const updatedMeta = resolveAgentMeta(updatedRaw);
  assert.strictEqual(updatedMeta.signature, 'Custom vBulletin Sig // Molecular');
});

test('ui-handlers and routes: provides forum categories, agent directory, and signature update endpoints', () => {
  const db = setupTestDb();
  const now = Date.now();
  db.prepare("INSERT INTO agents (id, name, role, status, heartbeat) VALUES ('@lead', 'Lead Agent', 'coordinator', 'busy', ?)").run(now);
  db.prepare("INSERT INTO agent_feed (timestamp, author_id, event_type, message) VALUES (?, '@lead', 'broadcast', 'Hello vBulletin')").run(now);

  const status = handleSwarmStatus(db);
  assert.ok(Array.isArray(status.forumCategories));
  assert.strictEqual(status.forumCategories.length, 5);
  assert.ok(Array.isArray(status.agents));
  assert.strictEqual(status.agents[0].statusBeacon, 'busy');
  assert.ok(status.posts[0].tokenStamp.includes('Cost: $'));

  const getCatRes = routeGet('/api/categories', db);
  assert.strictEqual(getCatRes.success, true);
  assert.strictEqual(getCatRes.categories.length, 5);

  const getAgentsRes = routeGet('/api/swarm/agents', db);
  assert.strictEqual(getAgentsRes.success, true);
  assert.strictEqual(getAgentsRes.agents.length, 1);

  const postSigRes = routePost('/api/swarm/agents/signature', db, { agentId: '@lead', signature: 'New Lead Sig' });
  assert.strictEqual(postSigRes.success, true);

  const checkUpdated = routeGet('/api/agents', db);
  assert.strictEqual(checkUpdated.agents[0].signature, 'New Lead Sig');
});

test('ui-templates: templates include forum categories, postbit layout, and agent directory', () => {
  assert.ok(VIEW_FORUM_TEMPLATE.includes('vb-table'));
  assert.ok(VIEW_FORUM_TEMPLATE.includes('vb-postbit'));
  assert.ok(VIEW_FORUM_TEMPLATE.includes('vb-postbit__author'));
  assert.ok(VIEW_FORUM_TEMPLATE.includes('vb-token-stamp'));
  assert.ok(VIEW_FORUM_TEMPLATE.includes('vb-signature'));

  assert.ok(VIEW_AGENTS_TEMPLATE.includes('vb-agent-grid'));
  assert.ok(VIEW_AGENTS_TEMPLATE.includes('vb-agent-card'));
  assert.ok(VIEW_AGENTS_TEMPLATE.includes('openAgentProfile'));

  assert.ok(AGENT_MODAL_TEMPLATE.includes('selectedAgent'));
  assert.ok(AGENT_MODAL_TEMPLATE.includes('saveSignature'));

  assert.ok(UI_TEMPLATE.includes('Forum & Timeline'));
  assert.ok(UI_TEMPLATE.includes('Agent Directory'));
});

test('forum topics: routeGet and routePost handle real topics and discussions', () => {
  const db = setupTestDb();
  const createRes = routePost('/api/topics', db, {
    categoryId: 'announcements',
    title: 'AST Architecture Standards',
    featureTag: 'AST',
    authorId: '@user',
    message: 'Mandatory 100-line outer bound per capsule file.'
  });
  assert.strictEqual(createRes.success, true);
  assert.strictEqual(createRes.topic.title, 'AST Architecture Standards');

  const getTopicsRes = routeGet('/api/topics', db);
  assert.strictEqual(getTopicsRes.success, true);
  assert.strictEqual(getTopicsRes.topics.length, 1);
  assert.strictEqual(getTopicsRes.topics[0].featureTag, 'AST');

  const getPostsRes = routeGet(`/api/topics/posts?topicId=${createRes.topic.id}`, db);
  assert.strictEqual(getPostsRes.success, true);
  assert.strictEqual(getPostsRes.posts.length, 1);
  assert.strictEqual(getPostsRes.posts[0].author, '@user');
  assert.ok(getPostsRes.posts[0].message.includes('100-line outer bound'));
});

test('profile clickability: author badges and cards trigger openAgentProfile across views', () => {
  assert.ok(VIEW_FORUM_TEMPLATE.includes('openAgentProfile'));
  assert.ok(VIEW_TOPIC_THREAD_TEMPLATE.includes('openAgentProfile'));
  assert.ok(VIEW_KANBAN_TEMPLATE.includes('openAgentProfile'));
  assert.ok(VIEW_AGENTS_TEMPLATE.includes('openAgentProfile'));
});
