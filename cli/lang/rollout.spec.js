/** Rollout stages (design spec 4.4): record default, .chemxrc, CHEMX_LANG_STAGE, then the legacy kill switch. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { effectiveStage, isShadowLogging, withStages, resetRolloutCache } from './rollout.js';
import { allLanguages } from './registry.js';
import { CAPABILITIES } from './vocab.js';

const savedEnv = {};
const restoreEnv = (name, value) => {
  const isUnset = value === undefined;
  if (isUnset) delete process.env[name];
  else process.env[name] = value;
};
const setEnv = (name, value) => {
  const isFirstTouch = !(name in savedEnv);
  if (isFirstTouch) savedEnv[name] = process.env[name];
  restoreEnv(name, value);
};

afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    restoreEnv(name, value);
    delete savedEnv[name];
  }
  resetRolloutCache();
});

const project = (languages) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-rollout-'));
  const hasConfig = Boolean(languages);
  if (hasConfig) fs.writeFileSync(path.join(root, '.chemxrc'), JSON.stringify({ languages }));
  return root;
};

test('with no config the effective stage is the record default for every language and capability', () => {
  setEnv('CHEMX_LANG_STAGE', undefined);
  setEnv('CHEMX_LANG_ENGINE', undefined);
  const root = project(null);
  for (const record of allLanguages()) {
    for (const cap of CAPABILITIES) {
      const expected = record.stages[cap] ?? 'off';
      assert.equal(effectiveStage(record.id, cap, root), expected, `${record.id}:${cap}`);
    }
  }
});

test('an unknown language is off', () => {
  assert.equal(effectiveStage('nope', 'index', project(null)), 'off');
});

test('.chemxrc languages.stages overrides the record default', () => {
  setEnv('CHEMX_LANG_STAGE', undefined);
  const root = project({ stages: { python: { index: 'shadow', outline: 'on' } } });
  assert.equal(effectiveStage('python', 'index', root), 'shadow');
  assert.equal(effectiveStage('python', 'outline', root), 'on');
  assert.equal(effectiveStage('python', 'imports', root), 'text');
  assert.equal(effectiveStage('go', 'index', root), 'text');
});

test('invalid config stages and capabilities are ignored', () => {
  const root = project({ stages: { python: { index: 'bogus', nothing: 'on' }, ghost: { index: 'on' } } });
  assert.equal(effectiveStage('python', 'index', root), 'text');
});

test('languages.disable turns every capability of a language off', () => {
  const root = project({ disable: ['go'] });
  for (const cap of CAPABILITIES) assert.equal(effectiveStage('go', cap, root), 'off');
  assert.equal(effectiveStage('rust', 'source', root), 'on');
});

test('requireGrammars drops a language without a vetted grammar from shadow/on to text', () => {
  const record = allLanguages().find((r) => r.parse.grammarStatus !== 'vetted' && r.stages.index === 'text');
  assert.ok(record, 'a shipped record without a vetted grammar exists');
  const stages = { [record.id]: { index: 'on' } };
  assert.equal(effectiveStage(record.id, 'index', project({ stages })), 'on');
  assert.equal(effectiveStage(record.id, 'index', project({ stages, requireGrammars: true })), 'text');
  assert.equal(effectiveStage(record.id, 'index', project({ stages, requireGrammars: [record.id] })), 'text');
  assert.equal(effectiveStage(record.id, 'index', project({ stages, requireGrammars: ['other'] })), 'on');
});

test('CHEMX_LANG_STAGE overrides .chemxrc, accepts several entries and skips malformed ones', () => {
  const root = project({ stages: { python: { index: 'shadow' } } });
  setEnv('CHEMX_LANG_STAGE', 'python:index=on, go:outline=shadow ,bad,python:nope=on,rust:index=wat');
  assert.equal(effectiveStage('python', 'index', root), 'on');
  assert.equal(effectiveStage('go', 'outline', root), 'shadow');
  assert.equal(effectiveStage('rust', 'index', root), 'text');
});

test('CHEMX_LANG_ENGINE=legacy beats config, env and overrides but keeps the babel/sfc path', () => {
  const root = project({ stages: { python: { index: 'on' }, javascript: { index: 'off' } } });
  setEnv('CHEMX_LANG_STAGE', 'go:index=on');
  setEnv('CHEMX_LANG_ENGINE', undefined);
  assert.equal(effectiveStage('python', 'index', root), 'on');
  setEnv('CHEMX_LANG_ENGINE', 'legacy');
  withStages({ 'python:index': 'on' }, () => {
    assert.equal(effectiveStage('python', 'index', root), 'text');
  });
  assert.equal(effectiveStage('go', 'index', root), 'text');
  assert.equal(effectiveStage('javascript', 'index', root), 'on');
  assert.equal(effectiveStage('php', 'source', root), 'off');
});

test('withStages overrides for the callback and restores afterwards, sync and async', async () => {
  setEnv('CHEMX_LANG_STAGE', undefined);
  const root = project(null);
  const out = withStages({ 'python:index': 'shadow' }, () => effectiveStage('python', 'index', root));
  assert.equal(out, 'shadow');
  assert.equal(effectiveStage('python', 'index', root), 'text');
  const inner = await withStages({ 'go:index': 'on' }, async () => {
    await Promise.resolve();
    return effectiveStage('go', 'index', root);
  });
  assert.equal(inner, 'on');
  assert.equal(effectiveStage('go', 'index', root), 'text');
  const restore = withStages({ 'rust:index': 'on' });
  assert.equal(effectiveStage('rust', 'index', root), 'on');
  restore();
  assert.equal(effectiveStage('rust', 'index', root), 'text');
});

test('withStages with a language wildcard sets every capability of that language', () => {
  const root = project(null);
  withStages({ 'go:*': 'off' }, () => {
    for (const cap of CAPABILITIES) assert.equal(effectiveStage('go', cap, root), 'off');
  });
});

test('isShadowLogging follows .chemxrc languages.shadow or CHEMX_LANG_SHADOW=1', () => {
  setEnv('CHEMX_LANG_SHADOW', undefined);
  assert.equal(isShadowLogging(project(null)), false);
  assert.equal(isShadowLogging(project({ shadow: true })), true);
  setEnv('CHEMX_LANG_SHADOW', '1');
  assert.equal(isShadowLogging(project(null)), true);
});

test('loadProjectConfig exposes a normalized languages block', async () => {
  const { loadProjectConfig } = await import('../config/index.js');
  const root = project({ map: { 'bin/*': 'shell', x: 3 }, grammars: { dir: '/g' }, stages: 'junk', disable: ['go', 7] });
  const { languages } = loadProjectConfig(root);
  assert.deepEqual(languages.map, { 'bin/*': 'shell' });
  assert.deepEqual(languages.disable, ['go']);
  assert.deepEqual(languages.stages, {});
  assert.equal(languages.grammars.dir, '/g');
  assert.equal(languages.shadow, false);
});
