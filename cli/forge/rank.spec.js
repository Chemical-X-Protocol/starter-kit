// rank.js call-idiom demotion (#5889): a group of single-line single calls of a library or global is
// scored down; shapes with logic, local imports or a mass above the cap are not; several library calls on one line are.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isCallIdiom, isBuildWindow, rankGroups, scoreOf, BUILD_WINDOW, CALL_IDIOM } from './rank.js';

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

const windowGroup = (anchors, extra = {}) => group(anchors, { path: 'W', kind: 'window', ...extra });

test('a W group of one push or write call is a string-building window and is scored down; other windows are not (#5909)', () => {
  const build = windowGroup(['call:push', 'str:""']);
  assert.equal(isBuildWindow(build), true);
  assert.equal(isBuildWindow(windowGroup(['call:write', 'global:process'])), false);
  assert.equal(isBuildWindow(windowGroup(['call:push', 'call:split'])), false);
  assert.equal(isBuildWindow(windowGroup(['call:map'])), false);
  assert.equal(isBuildWindow({ ...build, path: 'N2' }), false);
  const plain = windowGroup(['call:map']);
  assert.ok(Math.abs(scoreOf(build) - scoreOf(plain) * BUILD_WINDOW.weight) < 1e-9);
});

const sited = (id, spans, anchors, extra = {}) => ({
  ...group(anchors, { id, path: 'N2', kind: 'window', memberCount: spans.length, ...extra }),
  instances: spans.map(([file, start, end]) => ({ ...instance(anchors), kind: 'window', file, start, end }))
});

test('a slot whose instances overlap a higher slot joins it with its members; disjoint sites stay apart (#5909)', () => {
  const host = sited('host', [['a.js', 10, 50], ['b.js', 10, 50], ['c.js', 10, 50]], ['call:push', 'str:""', 'import:fs#default'], { mass: 30 });
  const twin = sited('twin', [['a.js', 20, 30], ['b.js', 0, 100]], ['call:join', 'str:"x"', 'import:path#default'], { mass: 50 });
  const apart = sited('apart', [['a.js', 100, 140], ['b.js', 100, 140]], ['call:join', 'str:"x"', 'import:path#default'], { mass: 4 });
  const ranked = rankGroups([host, twin, apart]);
  assert.equal(twin.foldedInto, 'host');
  assert.equal(twin.foldReason, 'sites');
  assert.deepEqual(host.folded.map((member) => member.id), ['twin']);
  assert.equal(apart.foldedInto, null);
  assert.deepEqual(ranked.filter((entry) => entry.rank !== null).map((entry) => entry.id), ['host', 'apart']);
});

test('a group that is a part of a higher slot call chain in the same files joins it (#5909)', () => {
  const host = sited('host', [['a.js', 10, 20], ['b.js', 10, 20]], ['call:stringify', 'call:write', 'global:process', 'call:exit']);
  const part = sited('part', [['a.js', 40, 50], ['b.js', 40, 50]], ['call:write', 'global:process', 'call:exit'], { mass: 5 });
  rankGroups([host, part]);
  assert.equal(part.foldedInto, 'host');
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
