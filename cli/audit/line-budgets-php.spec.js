import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLineBudgets } from './budget-rules.js';
import { resolveFileTier, isViewMarkupFile } from './line-budgets.js';

const phpLines = (n) => `<?php\n${Array.from({ length: n - 1 }, (_, i) => `echo ${i};`).join('\n')}\n`;
const check = (relativePath, lines) => checkLineBudgets({ content: phpLines(lines), relativePath, config: {} });

test('a 210-line PHP partial gives VIEW_MONOLITH at MEDIUM', () => {
  const hits = check('admin/partials/x.php', 210);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, 'VIEW_MONOLITH');
  assert.equal(hits[0].severity, 'MEDIUM');
});

test('a 210-line PHP template gives VIEW_MONOLITH', () => {
  assert.deepEqual(check('plugin/templates/x.php', 210).map((v) => v.rule), ['VIEW_MONOLITH']);
});

test('a 200-line PHP partial stays inside the view budget', () => {
  assert.deepEqual(check('admin/partials/x.php', 200), []);
});

test('a 520-line PHP partial gives LINE_BUDGET_FILE MEDIUM, never VIEW_MONOLITH', () => {
  const hits = check('admin/partials/x.php', 520);
  assert.deepEqual(hits.map((v) => [v.rule, v.severity]), [['LINE_BUDGET_FILE', 'MEDIUM']]);
});

test('PHP outside partials and templates has no view tier', () => {
  assert.deepEqual(check('includes/class-x.php', 210), []);
  assert.equal(resolveFileTier('includes/class-x.php'), null);
  assert.equal(isViewMarkupFile('includes/class-x.php'), false);
});

test('PHP has no molecule tier, even under molecules/ or an m- name', () => {
  assert.equal(resolveFileTier('src/molecules/x.php'), null);
  assert.equal(resolveFileTier('src/m-widget.php'), null);
});

test('a PHP partial resolves to the view tier and counts as view markup', () => {
  assert.equal(resolveFileTier('admin/partials/x.php'), 'view');
  assert.equal(isViewMarkupFile('admin/partials/x.php'), true);
});
