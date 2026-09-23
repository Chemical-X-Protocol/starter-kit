import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import {
  initProjectSession,
  getActiveProjectSession,
  getProjectSession,
  postProjectMessage,
  getProjectMessages,
  updateProjectSession
} from './team-projects.js';
import {
  recordVerifiedLearning,
  queryRelevantLearnings,
  formatLearningsCard
} from './team-projects-memory.js';
import { executeCoordinatorStep } from './team-projects-coordinator.js';
import { formatProjectStatusCard } from './team-projects-format.js';

const createCleanDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

test('projects: session lifecycle and messages', () => {
  const db = createCleanDb();
  const session = initProjectSession(db, {
    title: 'Modernize Atoms',
    goal: 'Eliminate raw DOM in buttons',
    budgetLimit: 5.0,
    maxTurns: 3
  });

  assert.ok(session);
  assert.equal(session.title, 'Modernize Atoms');
  assert.equal(session.status, 'active');
  assert.equal(session.current_turn, 0);

  const active = getActiveProjectSession(db);
  assert.equal(active.id, session.id);

  postProjectMessage(db, {
    projectId: session.id,
    authorId: '@user',
    message: 'Start with primary button'
  });

  const msgs = getProjectMessages(db, session.id);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].message, 'Start with primary button');
});

test('projects: compounding memory and relevance filtering', () => {
  const db = createCleanDb();
  const res1 = recordVerifiedLearning(db, {
    tier: 'molecule',
    pattern: 'BUTTON_EVENT_BUBBLE',
    ruleText: 'Use semantic emit instead of DOM bubbling',
    provenancePath: 'src/ui/molecules/m-card.vue'
  });
  assert.equal(res1.verified_count, 1);

  const res2 = recordVerifiedLearning(db, {
    tier: 'molecule',
    pattern: 'BUTTON_EVENT_BUBBLE',
    ruleText: 'Use semantic emit instead of DOM bubbling'
  });
  assert.equal(res2.verified_count, 2);

  const molLearnings = queryRelevantLearnings(db, { tier: 'molecule' });
  assert.equal(molLearnings.length, 1);
  assert.equal(molLearnings[0].pattern, 'BUTTON_EVENT_BUBBLE');

  const card = formatLearningsCard(molLearnings);
  assert.ok(card.includes('BUTTON_EVENT_BUBBLE'));
});

test('projects: coordinator step execution and limits', () => {
  const db = createCleanDb();
  const session = initProjectSession(db, {
    title: 'Test Coordinator',
    goal: 'Verify circuit breakers',
    budgetLimit: 0.05,
    maxTurns: 2
  });

  const step1 = executeCoordinatorStep(db, { costUsd: 0.01 });
  assert.equal(step1.status, 'ok');
  assert.equal(step1.turn, 1);

  const step2 = executeCoordinatorStep(db, { costUsd: 0.01 });
  assert.equal(step2.status, 'ok');
  assert.equal(step2.turn, 2);

  // Turn limit trip
  const step3 = executeCoordinatorStep(db, { costUsd: 0.01 });
  assert.equal(step3.status, 'paused_turns_exceeded');

  // Budget limit trip test
  const budgetDb = createCleanDb();
  const budgetSession = initProjectSession(budgetDb, {
    title: 'Budget Test',
    goal: 'Exceed budget',
    budgetLimit: 0.01,
    maxTurns: 10
  });
  const budgetStep1 = executeCoordinatorStep(budgetDb, { costUsd: 0.02 });
  assert.equal(budgetStep1.status, 'ok');
  const budgetStep2 = executeCoordinatorStep(budgetDb, { costUsd: 0.01 });
  assert.equal(budgetStep2.status, 'paused_budget_exceeded');

  const statusCard = formatProjectStatusCard({ session: budgetStep2.session });
  assert.ok(statusCard.includes('Budget Test'));
});
