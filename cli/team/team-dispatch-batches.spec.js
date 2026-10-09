/**
 * Dispatch batching (#2005): file extraction, file-disjoint batches, same-file grouping,
 * lease skips, capacity limits and stable handles.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatchScope,
  extractDescriptionFiles,
  normalizeTaskFile,
  planDispatchBatches,
  taskFiles
} from './team-dispatch-batches.js';

const task = (id, target, extra = {}) => ({ id, title: `Task ${id}`, description: '', target_path: target, priority: 2, needs: 'standard', rule_id: '', ...extra });

const fileSets = (plan) => plan.batches.map((batch) => batch.files);

const assertDisjoint = (plan) => {
  const seen = new Map();
  for (const batch of plan.batches) {
    for (const file of batch.files) {
      const owner = seen.get(file);
      assert.equal(owner, undefined, `${file} is in ${owner} and ${batch.handle}`);
      seen.set(file, batch.handle);
    }
  }
};

test('extractDescriptionFiles: finds paths with line suffixes, backticks and absolute paths, skips URLs and globs', () => {
  const text = 'File: cli/a.js (Lines: 3,7)\nSee `src/b.vue:12-20` and /work/root/c.ts.\nDocs https://example.test/x.js and **/*.md';
  assert.deepEqual(extractDescriptionFiles(text), ['cli/a.js', 'src/b.vue', '/work/root/c.ts']);
});

test('taskFiles: target_path plus description locations, relativised to root and deduped', () => {
  const files = taskFiles(task(1, 'cli/a.js', { description: 'File: cli/a.js\nalso /work/root/cli/b.js, not /tmp/scratch/c.mjs' }), { root: '/work/root' });
  assert.deepEqual(files, ['cli/a.js', 'cli/b.js']);
  assert.deepEqual(taskFiles(task(2, './x.js', { description: 'mentions y.js' }), { useDescription: false }), ['x.js']);
  assert.equal(normalizeTaskFile('/elsewhere/z.js', '/work/root'), '/elsewhere/z.js');
});

test('taskFiles: with isKnownFile, description mentions must resolve while target_path always counts', () => {
  const known = new Set(['cli/b.js']);
  const files = taskFiles(task(1, 'cli/new.js', { description: 'see b.js, cli/b.js and tests/example.spec.ts' }), { isKnownFile: (file) => known.has(file) });
  assert.deepEqual(files, ['cli/b.js', 'cli/new.js']);
});

test('taskFiles: a description mention in a sub-repo task is read in that repo and handed out root-relative (#2488)', () => {
  const repoTask = task(1, 'apps/kit/cli/a.js', { repo: 'apps/kit', description: 'Also update cli/b.js to match.' });
  const known = new Set(['apps/kit/cli/b.js', 'cli/b.js']);
  assert.deepEqual(taskFiles(repoTask, { isKnownFile: (file) => known.has(file) }), ['apps/kit/cli/a.js', 'apps/kit/cli/b.js']);
  const onlyRootHasIt = new Set(['cli/b.js']);
  assert.deepEqual(taskFiles(repoTask, { isKnownFile: (file) => onlyRootHasIt.has(file) }), ['apps/kit/cli/a.js']);
  assert.deepEqual(taskFiles(repoTask, {}), ['apps/kit/cli/a.js', 'apps/kit/cli/b.js']);
  const rooted = task(2, 'apps/kit/cli/a.js', { repo: 'apps/kit', description: 'See apps/kit/cli/c.js' });
  assert.deepEqual(taskFiles(rooted, { isKnownFile: (file) => file === 'apps/kit/cli/c.js' }), ['apps/kit/cli/a.js', 'apps/kit/cli/c.js']);
});

test('planDispatchBatches: tasks on different files land in file-disjoint batches with stable handles', () => {
  const plan = planDispatchBatches([task(1, 'a.js'), task(2, 'b.js'), task(3, 'c.js')], { maxAgents: 4, maxTasksPerAgent: 1 });
  assert.deepEqual(plan.batches.map((batch) => batch.handle), ['@dispatch-queue-1', '@dispatch-queue-2', '@dispatch-queue-3']);
  assert.deepEqual(fileSets(plan), [['a.js'], ['b.js'], ['c.js']]);
  assertDisjoint(plan);
  assert.deepEqual(plan.skipped, []);
  const again = planDispatchBatches([task(1, 'a.js'), task(2, 'b.js'), task(3, 'c.js')], { maxAgents: 4, maxTasksPerAgent: 1 });
  assert.deepEqual(again.batches.map((batch) => batch.handle), plan.batches.map((batch) => batch.handle));
});

test('planDispatchBatches: tasks sharing a file (directly or through a description) stay in one batch', () => {
  const tasks = [
    task(1, 'a.js'),
    task(2, 'b.js'),
    task(3, 'a.js', { description: 'Also touches `c.js:4`' }),
    task(4, 'c.js')
  ];
  const plan = planDispatchBatches(tasks, { maxAgents: 4, maxTasksPerAgent: 3 });
  assert.equal(plan.batches.length, 2);
  const shared = plan.batches.find((batch) => batch.files.includes('a.js'));
  assert.deepEqual(shared.tasks.map((entry) => entry.id), [1, 3, 4]);
  assert.deepEqual(shared.files, ['a.js', 'c.js']);
  assertDisjoint(plan);
});

test('planDispatchBatches: same-file overflow waits for the next run instead of splitting across agents', () => {
  const tasks = [task(1, 'a.js'), task(2, 'a.js'), task(3, 'a.js'), task(4, 'b.js')];
  const plan = planDispatchBatches(tasks, { maxAgents: 4, maxTasksPerAgent: 2 });
  assertDisjoint(plan);
  assert.deepEqual(plan.batches.map((batch) => batch.tasks.map((entry) => entry.id)), [[1, 2], [4]]);
  assert.deepEqual(plan.skipped.map((entry) => [entry.id, entry.reason]), [[3, 'same_file_overflow']]);
});

test('planDispatchBatches: groups are packed into existing batches once maxAgents is reached', () => {
  const tasks = [task(1, 'a.js'), task(2, 'b.js'), task(3, 'c.js'), task(4, 'd.js')];
  const plan = planDispatchBatches(tasks, { maxAgents: 1, maxTasksPerAgent: 3 });
  assert.equal(plan.batches.length, 1);
  assert.deepEqual(plan.batches[0].tasks.map((entry) => entry.id), [1, 2, 3]);
  assert.deepEqual(plan.skipped.map((entry) => [entry.id, entry.reason]), [[4, 'over_capacity']]);
});

test('planDispatchBatches: priority orders batches and a batch takes its highest tier', () => {
  const tasks = [
    task(1, 'a.js', { priority: 3, needs: 'light' }),
    task(2, 'b.js', { priority: 1, needs: 'light' }),
    task(3, 'b.js', { priority: 2, needs: 'deep' })
  ];
  const plan = planDispatchBatches(tasks, { maxAgents: 4, maxTasksPerAgent: 3 });
  assert.deepEqual(plan.batches[0].tasks.map((entry) => entry.id), [2, 3]);
  assert.equal(plan.batches[0].needs, 'deep');
  assert.equal(plan.batches[0].priority, 1);
  assert.equal(plan.batches[1].needs, 'light');
});

test('planDispatchBatches: a task whose file has a foreign lease is skipped and reported', () => {
  const leaseCheck = (file) => (file === 'b.js' ? { lockedBy: '@other', expiresAt: 99, purpose: '#7' } : null);
  const plan = planDispatchBatches([task(1, 'a.js'), task(2, 'b.js', { description: 'and a.js' })], { leaseCheck });
  assert.deepEqual(plan.batches.map((batch) => batch.tasks.map((entry) => entry.id)), [[1]]);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].reason, 'locked');
  assert.deepEqual(plan.skipped[0].lease, { file: 'b.js', lockedBy: '@other', expiresAt: 99, purpose: '#7' });
});

test('planDispatchBatches: a lease check that throws fails open', () => {
  const leaseCheck = () => {
    throw new Error('db unavailable');
  };
  const plan = planDispatchBatches([task(1, 'a.js')], { leaseCheck });
  assert.equal(plan.batches.length, 1);
});

test('planDispatchBatches: fileless tasks are skipped unless allowFileless, then each gets its own batch', () => {
  const tasks = [task(1, null), task(2, null)];
  const strict = planDispatchBatches(tasks);
  assert.deepEqual(strict.skipped.map((entry) => entry.reason), ['no_files', 'no_files']);
  const loose = planDispatchBatches(tasks, { allowFileless: true });
  assert.equal(loose.batches.length, 2);
});

test('dispatchScope: parent id, then repo basename, then queue', () => {
  assert.equal(dispatchScope({ parent: 2006, repo: 'apps/foo' }), '2006');
  assert.equal(dispatchScope({ repo: 'apps/My Repo/' }), 'my-repo');
  assert.equal(dispatchScope({}), 'queue');
  const plan = planDispatchBatches([task(1, 'a.js')], { parent: 2006 });
  assert.equal(plan.batches[0].handle, '@dispatch-2006-1');
});
