/**
 * Task extra files (#4426): extras join the target for lanes, lease and dirty screens.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExtraFiles, planLanes, screenTasks } from './team-dispatch-select.js';
import { planDispatchBatches, taskFiles } from './team-dispatch-batches.js';
import { renderTaskPrompts } from './team-dispatch-prompts.js';

const task = (id, target, extra) => ({ id, title: `t${id}`, target_path: target, extra_files: extra, priority: 2 });
const ctx = (over = {}) => ({ root: '/r', dispatcher: '@d', limit: 10, ...over });

test('parseExtraFiles drops blanks, dupes and the target, tolerating bad JSON', () => {
  assert.deepEqual(parseExtraFiles('["a.js","./b.js","a.js","t.js",""]', '/r', 't.js'), ['a.js', 'b.js']);
  assert.deepEqual(parseExtraFiles(['x.js'], '/r', 't.js'), ['x.js']);
  assert.deepEqual(parseExtraFiles('not json', '/r', 't.js'), []);
});

test('entry files are the target plus extras', () => {
  const { ready } = screenTasks([task(1, 't.js', '["e.js"]')], ctx());
  assert.deepEqual(ready[0].files, ['t.js', 'e.js']);
  assert.deepEqual(ready[0].extraFiles, ['e.js']);
});

test('two tasks sharing an extra file land in one lane', () => {
  const { ready } = screenTasks([task(1, 'a.js', '["shared.js"]'), task(2, 'b.js', '["shared.js"]'), task(3, 'c.js')], ctx());
  const lanes = planLanes(ready, 3);
  const laneOf = (id) => lanes.findIndex((lane) => lane.tasks.some((t) => t.id === id));
  assert.equal(laneOf(1), laneOf(2));
  assert.notEqual(laneOf(3), laneOf(1));
});

test('a lease on an extra file skips the task', () => {
  const leaseCheck = (file) => (file === 'e.js' ? { lockedBy: '@peer', purpose: 'x' } : null);
  const { ready, skipped } = screenTasks([task(1, 't.js', '["e.js"]')], ctx({ leaseCheck }));
  assert.equal(ready.length, 0);
  assert.equal(skipped[0].reason, 'locked');
  assert.equal(skipped[0].lease.file, 'e.js');
});

test('a foreign uncommitted edit on an extra file skips the task', () => {
  const { skipped } = screenTasks([task(1, 't.js', '["e.js"]')], ctx({ dirtyFiles: new Set(['e.js']), ownsFile: () => false }));
  assert.equal(skipped[0].reason, 'uncommitted_changes');
});

test('taskFiles includes extra_files, so the batch plan puts tasks sharing one in a single batch', () => {
  assert.deepEqual(taskFiles(task(1, 'a.js', '["s.js"]'), { root: '/r', useDescription: false }), ['a.js', 's.js']);
  const { batches } = planDispatchBatches([task(1, 'a.js', '["s.js"]'), task(2, 'b.js', '["s.js"]'), task(3, 'c.js')], { root: '/r', useDescription: false });
  const batchOf = (id) => batches.findIndex((batch) => batch.tasks.some((t) => t.id === id));
  assert.equal(batchOf(1), batchOf(2));
  assert.notEqual(batchOf(3), batchOf(1));
});

test('every prompt of a task with a stored brief says how to read it, and says nothing without one (#7134)', () => {
  const { ready } = screenTasks([{ ...task(7, 't.js'), brief_chars: 1234 }, task(8, 'u.js')], ctx());
  assert.equal(ready[0].briefChars, 1234);
  assert.equal(ready[1].briefChars, 0);
  const plan = (briefChars) => ({
    run: 'r', root: '/r', dispatcher: '@d', goal: '', peers: [], lanes: [[7]],
    tasks: [{ id: 7, title: 't', description: 'd', needs: 'light', handle: '@r-7', reviewer: '@r-7-review', repairer: '@r-7-repair', target: 'a.js', files: ['a.js'], extraFiles: [], snapshot: {}, briefChars }]
  });
  const briefed = plan(1234);
  const prompts = renderTaskPrompts(briefed.tasks[0], briefed);
  for (const stage of ['build', 'review', 'repair']) assert.match(prompts[stage], /Long brief stored \(1234 characters\): read it before you start with chemx team task show 7 --full/);
  const plain = plan(0);
  assert.doesNotMatch(renderTaskPrompts(plain.tasks[0], plain).build, /Long brief/);
});

test('the builder prompt names the extra files it may edit, and says nothing without extras', () => {
  const plan = (extraFiles) => ({
    run: 'r', root: '/r', dispatcher: '@d', goal: '', peers: [], lanes: [[1]],
    tasks: [{ id: 1, title: 't', description: 'd', needs: 'light', handle: '@r-1', reviewer: '@r-1-review', repairer: '@r-1-repair', target: 'a.js', files: ['a.js', ...extraFiles], extraFiles, snapshot: {} }]
  });
  const withExtras = plan(['e.js']);
  assert.match(renderTaskPrompts(withExtras.tasks[0], withExtras).build, /You may also edit: e\.js/);
  const without = plan([]);
  assert.doesNotMatch(renderTaskPrompts(without.tasks[0], without).build, /may also edit/);
});
