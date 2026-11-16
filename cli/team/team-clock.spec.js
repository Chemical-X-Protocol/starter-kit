/** The standup clock rules (#7671): pure functions, no database. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextLight, setByDiscussion } from './team-clock.js';

const step = (current, o = {}) => nextLight({ current, hadUpdate: false, isManual: false, isBlocked: false, ...o });

test('rule 1: an update or done sends any light back to green', () => {
  for (const c of ['green', 'yellow', 'red']) assert.equal(step(c, { hadUpdate: true }), 'green');
});

test('rule 2: no update moves up one notch, red stays red', () => {
  assert.equal(step('green'), 'yellow');
  assert.equal(step('yellow'), 'red');
  assert.equal(step('red'), 'red');
});

test('rule 4: blocked holds, with or without an update', () => {
  assert.equal(step('blocked'), 'blocked');
  assert.equal(step('blocked', { hadUpdate: true }), 'blocked');
  assert.equal(step('green', { isBlocked: true }), 'blocked');
});

test('rule 3: a manual yellow or red resets, then the clock applies', () => {
  assert.equal(step('yellow', { isManual: true }), 'yellow');
  assert.equal(step('red', { isManual: true }), 'yellow');
  assert.equal(step('red', { isManual: true, hadUpdate: true }), 'green');
});

test('rule 3: discussion accepts yellow or blocked', () => {
  assert.deepEqual(setByDiscussion('yellow'), { ok: true, light: 'yellow' });
  assert.deepEqual(setByDiscussion('blocked'), { ok: true, light: 'blocked' });
});

test('rule 3: discussion refuses green, red and junk', () => {
  for (const bad of ['green', 'red', 'purple', undefined]) {
    const r = setByDiscussion(bad);
    assert.equal(r.ok, false);
    assert.match(r.error, /yellow or blocked/);
  }
});
