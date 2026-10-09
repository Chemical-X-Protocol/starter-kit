import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { auditCode } from './rules.js';
import { countLines, getLineBudgets, lineLimitFor, resolveFileTier, FILE_BUDGET } from './line-budgets.js';
import { getProfileDefaults } from '../config/profiles.js';

const rulesAt = (violations, rule) => violations.filter((v) => v.rule === rule);
const linesOf = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';

test('line count matches wc -l: a trailing newline does not add a line', () => {
  assert.equal(countLines('a\nb\n'), 2);
  assert.equal(countLines('a\nb'), 2);
  assert.equal(rulesAt(auditCode(linesOf(500), 'src/five-hundred.ts', 'src/five-hundred.ts'), 'LINE_BUDGET_FILE').length, 0);
  const over = rulesAt(auditCode(linesOf(501), 'src/five-hundred.ts', 'src/five-hundred.ts'), 'LINE_BUDGET_FILE');
  assert.equal(over.length, 1);
  assert.match(over[0].hazard, /501 > 500/);
});

test('VIEW_MONOLITH never applies to a .ts controller under views/', () => {
  const rel = 'src/views/compass-dashboard.controller.ts';
  assert.equal(rulesAt(auditCode(linesOf(300), rel, rel), 'VIEW_MONOLITH').length, 0);
});

test('VIEW_MONOLITH measures the template block of a .vue view', () => {
  const template = Array.from({ length: 210 }, () => '  <p>row</p>').join('\n');
  const code = `<template>\n<div>\n${template}\n</div>\n</template>\n<script setup lang="ts">\nconst a = 1\n</script>\n`;
  const rel = 'src/views/home.vue';
  const hits = rulesAt(auditCode(code, rel, rel), 'VIEW_MONOLITH');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, 'MEDIUM');
});

test('pragmatic molecule budget is a soft warning only with high complexity; atomic-strict is a hard cap', () => {
  const rel = 'src/molecules/m-card/m-card.ts';
  const pragmatic = { rules: getProfileDefaults('pragmatic') };
  assert.equal(rulesAt(auditCode(linesOf(300), rel, rel, { config: pragmatic }), 'LINE_BUDGET_MOLECULE').length, 0);
  const strict = { rules: getProfileDefaults('atomic-strict') };
  const hits = rulesAt(auditCode(linesOf(120), rel, rel, { config: strict }), 'LINE_BUDGET_MOLECULE');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, 'MEDIUM');
});

test('molecule tier globs are configurable', () => {
  assert.equal(resolveFileTier('src/components/prefabs/x-card.vue', {}), null);
  assert.equal(resolveFileTier('src/components/prefabs/x-card.vue', { tiers: { molecule: ['**/prefabs/**'] } }), 'molecule');
});

test('one source of truth: profile budgets match the AGENTS.md and README policy text', () => {
  assert.equal(getLineBudgets(getProfileDefaults('pragmatic')).molecule, 250);
  assert.equal(getLineBudgets(getProfileDefaults('atomic-strict')).molecule, 100);
  const agents = fs.readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf-8');
  assert.match(agents, /Soft warning at 250 lines only if cyclomatic complexity is high/);
  assert.match(agents, new RegExp(`above ${FILE_BUDGET.warn} lines.*${FILE_BUDGET.high.toLocaleString('en-US')}.*${FILE_BUDGET.critical.toLocaleString('en-US')}`));
  const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf-8');
  assert.doesNotMatch(readme, /exceeding 100, 500, or 1,000 lines/);
});

test('enforce-file-length under pragmatic defaults holds molecules to the atomic-strict 100 (ported from afdd8af)', () => {
  const budgets = getLineBudgets({ ...getProfileDefaults('pragmatic'), enforceFileLength: true });
  assert.equal(budgets.profile, 'atomic-strict');
  assert.equal(budgets.molecule, 100);
  assert.equal(budgets.isMoleculeHardCap, true);
});

test('the molecule budget never exceeds the 500-line file bound (ported from 98c65c0)', () => {
  assert.equal(getLineBudgets({ ...getProfileDefaults('pragmatic'), maxLineCountWarning: 800 }).molecule, FILE_BUDGET.warn);
  assert.equal(getLineBudgets(getProfileDefaults('loose')).molecule, 500);
  assert.equal(lineLimitFor('src/molecules/m-x.ts', { ...getProfileDefaults('pragmatic'), maxLineCountWarning: 800 }), 500);
});

test('a non-positive or non-numeric molecule warning falls back to the profile default (ported from 94f8c6f)', () => {
  for (const bad of ['abc', 0, -5, '', null]) {
    assert.equal(getLineBudgets({ ...getProfileDefaults('pragmatic'), maxLineCountWarning: bad }).molecule, 250, `pragmatic ${bad}`);
    assert.equal(getLineBudgets({ ...getProfileDefaults('loose'), maxLineCountWarning: bad }).molecule, 500, `loose ${bad}`);
  }
  assert.equal(getLineBudgets({ ...getProfileDefaults('pragmatic'), maxLineCountWarning: '180' }).molecule, 180);
});
