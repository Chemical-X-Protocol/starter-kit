// rank.js call-idiom demotion (#5889): a group of single-line single calls of a library or global is
// scored down; shapes with logic, local imports or a mass above the cap are not; several library calls on one line are.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isCallIdiom, scoreOf, CALL_IDIOM } from './rank.js';

const instance = (anchors, extra = {}) => ({ file: 'a.js', kind: 'stmt', startLine: 3, endLine: 3, mass: 9, anchors, ...extra });

const group = (anchors, extra = {}, instanceExtra = {}) => ({
  id: 'g', path: 'N1-fp1', kind: 'stmt', facetKey: 'js:plain:src:.', memberCount: 20, mass: 9, level: null,
  instances: [instance(anchors, instanceExtra), instance(anchors, instanceExtra)], ...extra
});

test('a single-line fs/path call is a call idiom and its score is scaled down', () => {
  const idiom = group(['call:existsSync', 'import:fs#default']);
  assert.equal(isCallIdiom(idiom), true);
  const plain = { ...idiom, instances: [instance(['call:existsSync', 'call:join', 'import:fs#default']), instance(['call:existsSync', 'call:join', 'import:fs#default'])] };
  assert.equal(isCallIdiom(plain), true);
  assert.equal(isCallIdiom(group(['call:mkdirSync', 'call:dirname', 'import:fs#default'], { mass: 30 })), false);
  const heavy = group(['call:existsSync', 'import:fs#default'], { mass: 30 });
  assert.ok(Math.abs(scoreOf(idiom) - (scoreOf(heavy) * 9 / 30) * CALL_IDIOM.weight) < 1e-9);
});

test('a global call counts as a library call', () => {
  assert.equal(isCallIdiom(group(['call:cwd', 'global:process'])), true);
});

test('a project-local import, a multi-line member, a heavy member or a function are not idioms', () => {
  assert.equal(isCallIdiom(group(['call:push', 'import:cli/audit/reporter-utils#RESET'])), false);
  assert.equal(isCallIdiom(group(['call:existsSync', 'import:fs#default'], {}, { endLine: 5 })), false);
  assert.equal(isCallIdiom(group(['call:existsSync', 'import:fs#default'], { mass: 40 })), false);
  assert.equal(isCallIdiom(group(['call:existsSync', 'import:fs#default'], {}, { kind: 'fn' })), false);
});
