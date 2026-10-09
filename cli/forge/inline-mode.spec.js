// Alias inlining is opt-in (#2595): off by default, on with CHEMX_FORGE_INLINE=1 or the inline option,
// and the mode is part of the extractor version. Also pins the default-off recall on the gt sandbox
// at a floor below the measured value (18/26 credit, 0.692, harvest-only).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, canonicalizeSource } from './canonicalize.js';
import { printCanonical } from './canon-print.js';
import { isInlineRequested, INLINE_VERSION_OFFSET } from './inline-mode.js';
import { FORGE_EXTRACTOR_VERSION } from './store.js';
import { createGtSandbox, gtItems } from './gt-sandbox.js';
import { runForgeGroups } from './forge-groups.js';
import { toScorerGroups } from './group-shape.js';
import { scoreGroups } from '../patterns/gt-score.js';

delete process.env.CHEMX_PROJECT_ROOT;
delete process.env.CHEMX_FORGE_INLINE;

const SOURCE = 'function host(a) { const k = a.x; return k; }';

test('the switch reads CHEMX_FORGE_INLINE=1 only', () => {
  assert.equal(isInlineRequested({}), false);
  assert.equal(isInlineRequested({ CHEMX_FORGE_INLINE: '0' }), false);
  assert.equal(isInlineRequested({ CHEMX_FORGE_INLINE: '1' }), true);
});

test('default canonicalization keeps the alias; the inline option folds it', () => {
  const { ast, bindings } = canonicalizeSource(SOURCE);
  const bodyOf = (program) => printCanonical(program.kids.body[0].kids.body);
  const off = bodyOf(canonicalize(ast.program, { bindings }));
  const on = bodyOf(canonicalize(ast.program, { bindings, inline: true }));
  assert.notEqual(off, on);
  assert.match(off, /const/);
});

test('this process runs the default mode, so the extractor version has no inline offset', () => {
  assert.ok(FORGE_EXTRACTOR_VERSION < INLINE_VERSION_OFFSET);
});

const cleanups = [];
after(() => cleanups.forEach((cleanup) => cleanup()));

test('default-off harvest-only recall on the gt sandbox stays at or above 0.65 with no B item surfaced', () => {
  const sandbox = createGtSandbox({ after: (cleanup) => cleanups.push(cleanup) });
  const result = runForgeGroups(sandbox.dir);
  const report = scoreGroups(gtItems(), toScorerGroups(result.groups));
  assert.ok(report.recallA.recall >= 0.65, `recall ${report.recallA.credit}/${report.recallA.items}`);
  assert.deepEqual(report.falseItems.surfaced, []);
});
