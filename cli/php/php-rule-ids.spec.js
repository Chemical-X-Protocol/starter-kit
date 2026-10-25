/**
 * Every rule id the PHP engine can name is in RULE_REGISTRY (design spec 3.4, T15b).
 * Checks: (1) each pass's declared ids and each family's RULE_DEFAULTS; (2) every id a pass
 * reports on any PHP fixture (bad and good, run straight through the passes with the WordPress
 * context and the project index, so no setting hides a record), and that the reporting pass
 * declares it; (3) every rule-shaped string literal in cli/php/*.js and in the precision specs
 * (cli/php/*.precision.spec.js). Not checked: an id built at runtime from parts, or an id a
 * pass reports only for an input none of these cases contains.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RULE_REGISTRY } from '../audit/rules-registry.js';
import { DEFAULT_PASSES, PHP_RULE_DEFAULTS, unregisteredRuleDrops, resetUnregisteredRuleDrops } from './php-analyzer.js';
import { auditCode } from '../audit/rules.js';
import { PHP_FIXTURES } from '../fixtures/php/index.js';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { getProjectIndex } from './wp-project-index.js';
import { parsePhp } from './php-parse.js';

const PHP_DIR = new URL('./', import.meta.url).pathname;
const WP_ROOT = path.join(PHP_DIR, '__no_such_plugin__');
const RULE_SHAPED = /['"]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)['"]/g;
const REGISTERED_PREFIXES = new Set(Object.keys(RULE_REGISTRY).map((rule) => rule.split('_')[0]));
const unregistered = (ids) => [...new Set(ids)].filter((rule) => !RULE_REGISTRY[rule]).sort();

test('every pass declares only registered ids, and every family default names a registered id', () => {
  assert.deepEqual(unregistered(DEFAULT_PASSES.flatMap((pass) => pass.rules)), []);
  assert.deepEqual(unregistered(Object.keys(PHP_RULE_DEFAULTS)), []);
});

const passRecords = (pass, fixture, code) => {
  const wp = { isWordPress: true, root: WP_ROOT, kind: 'plugin' };
  const filePath = path.join(WP_ROOT, 'demo.php');
  const index = getProjectIndex(WP_ROOT, { overlay: { relativePath: 'demo.php', content: code } });
  const ctx = buildPassContext(code, { path: filePath, config: fixture.config, wp, index });
  ctx.relativePath = 'demo.php';
  pass.run(ctx);
  return ctx.records.map((record) => record.rule);
};

test('every id a pass reports on a PHP fixture is registered and declared by that pass', () => {
  const undeclared = [];
  const reported = [];
  for (const [rule, fixture] of Object.entries(PHP_FIXTURES)) {
    // A source that does not parse reaches no pass (the analyzer reports SYNTAX_PARSE_ERROR itself).
    for (const variant of ['bad', 'good'].filter((v) => parsePhp(fixture[v]).ast)) {
      for (const pass of DEFAULT_PASSES) {
        const ids = passRecords(pass, fixture, fixture[variant]);
        reported.push(...ids);
        for (const id of ids.filter((x) => !pass.rules.includes(x))) undeclared.push(`${pass.name} -> ${id} (${rule} ${variant})`);
      }
    }
  }
  assert.deepEqual(unregistered(reported), []);
  assert.deepEqual([...new Set(undeclared)], []);
});

test('auditCode drops no PHP fixture finding as unregistered', () => {
  resetUnregisteredRuleDrops();
  for (const fixture of Object.values(PHP_FIXTURES)) {
    for (const variant of ['bad', 'good']) auditCode(fixture[variant], fixture.path, fixture.path, { config: fixture.config });
  }
  assert.deepEqual(unregisteredRuleDrops(), {});
});

const ruleShapedLiterals = (text) => [...text.matchAll(RULE_SHAPED)].map((m) => m[1])
  .filter((id) => REGISTERED_PREFIXES.has(id.split('_')[0]));

test('every rule-shaped literal in the PHP engine and its precision specs is registered', () => {
  const files = fs.readdirSync(PHP_DIR).filter((f) => f.endsWith('.js'))
    .filter((f) => !f.endsWith('.spec.js') || f.endsWith('.precision.spec.js'));
  const literalsByFile = files.map((file) => [file, ruleShapedLiterals(fs.readFileSync(path.join(PHP_DIR, file), 'utf-8'))]);
  const missing = literalsByFile.flatMap(([file, ids]) => unregistered(ids).map((id) => `${file}: ${id}`));
  assert.deepEqual(missing, []);
  // The scan is not vacuous: it sees every id each family names in its RULE_DEFAULTS.
  const seen = new Set(literalsByFile.flatMap(([, ids]) => ids));
  assert.deepEqual(Object.keys(PHP_RULE_DEFAULTS).filter((rule) => !seen.has(rule)), []);
});
