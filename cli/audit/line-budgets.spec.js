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

const moleculeWith = (profile, value) => getLineBudgets({ profile, maxLineCountWarning: value }).molecule;
// The molecule budget main's parseInt reading gives, before exponent text was read as a value.
const mainMoleculeWith = (profile, value) => {
  const leadingInteger = Number.parseInt(value, 10);
  const configured = leadingInteger > 0 ? leadingInteger : moleculeWith(profile, null);
  return Math.min(configured, FILE_BUDGET.warn);
};

test('exponent text reads as its value instead of its leading digit', () => {
  assert.equal(moleculeWith('loose', '1.8e2'), 180);
  assert.equal(moleculeWith('loose', '2e2'), 200);
  assert.equal(moleculeWith('loose', '2E+2'), 200);
  assert.equal(moleculeWith('loose', '1.855e2'), 185);
  assert.equal(moleculeWith('pragmatic', '1e3'), FILE_BUDGET.warn);
  assert.equal(moleculeWith('pragmatic', ' 180 '), 180);
});

test('hex, octal and binary text falls back to the profile default, as parseInt did', () => {
  for (const radixText of ['0x64', '0X64', '0o144', '0b1100100']) {
    assert.equal(moleculeWith('pragmatic', radixText), 250, `pragmatic ${radixText}`);
    assert.equal(moleculeWith('atomic-strict', radixText), 100, `atomic-strict ${radixText}`);
  }
});

test('suffixed and fractional values keep the leading-integer reading', () => {
  assert.equal(moleculeWith('atomic-strict', '300px'), 300);
  assert.equal(moleculeWith('atomic-strict', '250.5'), 250);
  assert.equal(moleculeWith('pragmatic', '180px'), 180);
  assert.equal(moleculeWith('pragmatic', '180.5'), 180);
  assert.equal(moleculeWith('pragmatic', 180.5), 180);
  assert.equal(moleculeWith('pragmatic', '400.5'), 400);
});

test('booleans, blanks, zero and negatives fall back to the profile default', () => {
  for (const bad of [true, false, '', '  ', 0, -5, '-5', 'abc', {}, Infinity, Number.NaN]) {
    assert.equal(moleculeWith('pragmatic', bad), 250, `pragmatic ${typeof bad} ${String(bad)}`);
    assert.equal(moleculeWith('atomic-strict', bad), 100, `atomic-strict ${typeof bad} ${String(bad)}`);
  }
});

test('no molecule budget falls below the one main read, so LINE_BUDGET_MOLECULE can only drop', () => {
  const values = ['1e3', '1.8e2', '0.5e2', '0.1e3', '500e-1', '5e-1', '1e999', '0x64', '0o144', '0b1100100', '300px',
    '250.5', '1e3px', true, false, '', 0, -5, 180.5, 1e21, [200], {}];
  for (const profile of ['pragmatic', 'atomic-strict', 'loose']) {
    for (const value of values) {
      const label = `${profile} ${typeof value} ${String(value)}`;
      assert.ok(moleculeWith(profile, value) >= mainMoleculeWith(profile, value), label);
    }
  }
});

// Report and funnel text outside docs-drift's GUIDANCE_FILES (ported from 2b58305 and b0c0213).
const PROFILE_BUDGET_TEXT_FILES = [
  'app/components/molecules/funnel/funnel-system-layers-core.data.ts', 'app/components/molecules/funnel/funnel-system-layers.data.ts',
  'cli/audit/reporter-grades.js', 'cli/audit/reporter-sections.js', 'cli/audit/reporter-summary.js', 'cli/audit/social.js'
];
// The FLAT_CAP of cli/docs-drift.spec.js, which self-tests it; the first assertion below keeps them equal.
const FLAT_CAP = /<\s*100\s*(lines?|LOC|L\b)|\b100[\s-]*(lines?|LOC|L)\b|\b(under|approaching|exceeding)\s+100\b/i;

test('guidance and report text name the profile molecule budget, not a flat 100-line cap', () => {
  const docsDrift = fs.readFileSync(new URL('../docs-drift.spec.js', import.meta.url), 'utf-8');
  assert.ok(docsDrift.includes(`const FLAT_CAP = /${FLAT_CAP.source}/i;`), 'same FLAT_CAP as cli/docs-drift.spec.js');
  const hits = PROFILE_BUDGET_TEXT_FILES.flatMap((rel) =>
    fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf-8').split('\n').flatMap((line, index) => {
      const isHit = FLAT_CAP.test(line) && !/atomic-strict/.test(line);
      return isHit ? [`${rel}:${index + 1}: ${line.trim().slice(0, 120)}`] : [];
    }));
  assert.deepEqual(hits, []);
});
