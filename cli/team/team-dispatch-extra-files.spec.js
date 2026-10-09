/**
 * Task extra files (#4426): extras join the target for lanes, lease and dirty screens.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExtraFiles, planLanes, screenTasks } from './team-dispatch-select.js';

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
