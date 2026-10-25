import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { auditCodeDetailed } from '../audit/rules.js';
import { RULE_REGISTRY } from '../audit/rules-registry.js';
import { RULE_REVISIONS } from '../audit/rule-revisions.js';
import {
  PASSES, DEFAULT_PASSES, PHP_DEFAULT_OFF, PHP_RULE_DEFAULTS, unregisteredRuleDrops, resetUnregisteredRuleDrops
} from './php-analyzer.js';
import { setPhpParserLoader, clearPhpParseCache } from './php-parse.js';
import { PHP_FIXTURES } from '../fixtures/php/index.js';

const PATH = '/p/plugin/a.php';
const REL = 'plugin/a.php';
const run = (src, options = {}, rel = REL) => auditCodeDetailed(src, '/p/' + rel, rel, options);
const GENERIC = ['php-metrics', 'php-control-flow', 'php-catch', 'php-logging', 'php-dangerous'];

const usePasses = (list) => {
  PASSES.length = 0;
  PASSES.push(...list);
};
const ranPasses = [];
const spiedPasses = () => DEFAULT_PASSES.map((pass) => ({ ...pass, run: (ctx) => { ranPasses.push(pass.name); pass.run(ctx); } }));

// Stub tests start from an empty pass list; tests of the shipped passes install spied copies.
beforeEach(() => {
  setPhpParserLoader(null);
  clearPhpParseCache();
  usePasses([]);
  ranPasses.length = 0;
  resetUnregisteredRuleDrops();
});
afterEach(() => {
  setPhpParserLoader(null);
  usePasses(DEFAULT_PASSES);
});

test('a clean file is ast coverage with language php and no reason', () => {
  const { violations, coverage } = run('<?php\nfunction f() { return 1; }\n');
  assert.deepEqual(coverage, { kind: 'ast', language: 'php', reason: null });
  assert.deepEqual(violations, []);
});

test('--fast is text-only with reason fast', () => {
  const { coverage } = run('<?php\nfunction f() { return 1; }\n', { fast: true });
  assert.deepEqual(coverage, { kind: 'text-only', language: 'php', reason: 'fast' });
});

test('a parse error is SYNTAX_PARSE_ERROR at the parser position with parse-error coverage', () => {
  const { violations, coverage } = run('<?php\n\nfoo(;\n');
  const err = violations.find((v) => v.rule === 'SYNTAX_PARSE_ERROR');
  assert.equal(err.line, 3);
  assert.equal(err.column, 4);
  assert.equal(err.severity, 'CRITICAL');
  assert.match(err.hazard, /^Parse error: /);
  assert.equal(coverage.kind, 'parse-error');
  assert.equal(coverage.language, 'php');
});

test('chemx-allow still works in a file with a syntax error', () => {
  const { violations } = run('<?php\n// chemx-allow: SYNTAX_PARSE_ERROR generated stub\nfoo(;\n');
  assert.ok(!violations.some((v) => v.rule === 'SYNTAX_PARSE_ERROR'));
});

test('an unavailable parser is text-only with reason parser-unavailable', () => {
  setPhpParserLoader(() => { throw new Error('missing'); });
  const { coverage } = run('<?php\nfunction f() {}\n');
  assert.deepEqual(coverage, { kind: 'text-only', language: 'php', reason: 'parser-unavailable' });
});

test('a minified file is text-only with reason minified', () => {
  const src = '<?php ' + 'echo 1;'.repeat(12000);
  const { coverage } = run(src);
  assert.deepEqual(coverage, { kind: 'text-only', language: 'php', reason: 'minified' });
});

test('AI_SLOP_ECHO_COMMENT is dropped for .php only', () => {
  const body = '// Get the user\n$x = get_user();\n';
  const php = run('<?php\n' + body, {}, 'a.php').violations.map((v) => v.rule);
  assert.ok(!php.includes('AI_SLOP_ECHO_COMMENT'));
  const js = auditCodeDetailed(body, '/p/a.js', 'a.js', {}).violations.map((v) => v.rule);
  assert.ok(js.includes('AI_SLOP_ECHO_COMMENT'));
});

test('a stub pass in PASSES gets pillar, directive and registry severity', () => {
  PASSES.push({ name: 'stub', rules: ['COMPLEXITY_CYCLOMATIC_HIGH'], run: (ctx) => ctx.report('COMPLEXITY_CYCLOMATIC_HIGH', 2, 'stub hazard') });
  const { violations } = run('<?php\nfunction f() {}\n');
  const v = violations.find((x) => x.rule === 'COMPLEXITY_CYCLOMATIC_HIGH');
  assert.equal(v.line, 2);
  assert.equal(v.filePath, REL);
  assert.ok(v.pillar && v.directive);
  assert.equal(v.severity, RULE_REGISTRY.COMPLEXITY_CYCLOMATIC_HIGH.severity);
});

test('a pass-supplied severity wins', () => {
  PASSES.push({ name: 'stub', rules: [], run: (ctx) => ctx.report('COMPLEXITY_CYCLOMATIC_HIGH', 1, 'x', { severity: 'LOW' }) });
  const { violations } = run('<?php\nfunction f() {}\n');
  const v = violations.find((x) => x.rule === 'COMPLEXITY_CYCLOMATIC_HIGH');
  assert.equal(v.severity, 'LOW');
});

test('an unregistered id is dropped and counted, never thrown', () => {
  PASSES.push({ name: 'stub', rules: [], run: (ctx) => { ctx.report('STUB_UNREGISTERED_RULE', 1, 'x'); ctx.report('STUB_UNREGISTERED_RULE', 2, 'y'); } });
  const { violations } = run('<?php\nfunction f() {}\n');
  assert.ok(!violations.some((x) => x.rule === 'STUB_UNREGISTERED_RULE'));
  assert.deepEqual(unregisteredRuleDrops(), { STUB_UNREGISTERED_RULE: 2 });
});

test('a catch report on a node carries the node end line as endLine', () => {
  PASSES.push({ name: 'stub', rules: [], run: (ctx) => ctx.report('ERROR_SWALLOWED_EXCEPTION', ctx.ast.children[0], 'x') });
  const { violations } = run('<?php\nfunction f() {\n  return 1;\n}\n');
  const v = violations.find((x) => x.rule === 'ERROR_SWALLOWED_EXCEPTION');
  assert.deepEqual([v.line, v.endLine], [2, 4]);
});

test('only a catch finding spans its node: a rule on a node carries no endLine', () => {
  PASSES.push({ name: 'stub', rules: [], run: (ctx) => ctx.report('COMPLEXITY_CYCLOMATIC_HIGH', ctx.ast.children[0], 'x') });
  const v = run('<?php\nfunction f() {\n  return 1;\n}\n').violations.find((x) => x.rule === 'COMPLEXITY_CYCLOMATIC_HIGH');
  assert.equal(v.endLine, undefined);
});

test('a chemx-allow above a nested closure does not suppress the outer function finding', () => {
  usePasses(spiedPasses());
  const ifs = (n) => Array.from({ length: n }, (_, i) => `if ($a === ${i}) { $b++; }`).join('\n');
  const src = (note) => `<?php\nfunction outer($a, $b) {\n${ifs(14)}\n${note}$f = function ($a, $b) {\n${ifs(14)}\n};\n}\n`;
  const lines = (code) => run(code).violations.filter((v) => v.rule === 'COMPLEXITY_CYCLOMATIC_HIGH').map((v) => v.line);
  assert.equal(lines(src('')).length, 2);
  assert.deepEqual(lines(src('// chemx-allow: COMPLEXITY_CYCLOMATIC_HIGH generated lookup\n')), [2]);
});

test('without a detected root the index never lists the working directory', () => {
  let seen;
  usePasses([{ name: 'probe', rules: [], run: (ctx) => { seen = ctx; } }]);
  const config = { rules: {}, overrides: [], wordpress: true };
  run(PHP_FIXTURES.SECURITY_WP_MISSING_NONCE.bad, { config }, 'wp-content/plugins/demo/demo.php');
  assert.ok(seen.index);
  assert.deepEqual(seen.index.files(), ['wp-content/plugins/demo/demo.php']);
});

test('the pass context carries the full config, target version and null wp and index', () => {
  let seen;
  PASSES.push({ name: 'probe', rules: [], run: (ctx) => { seen = ctx; } });
  run('<?php\nfunction f() {}\n', { config: { wordpress: false, rules: {} } });
  assert.equal(seen.config.wordpress, false);
  assert.equal(seen.phpTarget, '8.3');
  assert.equal(seen.wp, null);
  assert.equal(seen.index, null);
  assert.equal(seen.crossFile, true);
  run('<?php\nfunction f() {}\n', { config: { php: { version: '7.4' } }, crossFile: false });
  assert.equal(seen.phpTarget, '7.4');
  assert.equal(seen.crossFile, false);
});

test('a pass whose every rule is off through an overrides glob is skipped', () => {
  let ran = 0;
  PASSES.push({ name: 'stub', rules: ['STUB_RULE_A'], run: () => { ran += 1; } });
  const config = { rules: {}, overrides: [{ files: 'plugin/legacy/**', rules: { STUB_RULE_A: 'off' } }] };
  run('<?php\nfunction f() {}\n', { config }, 'plugin/legacy/x.php');
  assert.equal(ran, 0);
  run('<?php\nfunction f() {}\n', { config }, 'plugin/new/x.php');
  assert.equal(ran, 1);
});

test('a WordPress-only pass does not run while wp detection is absent', () => {
  let ran = 0;
  PASSES.push({ name: 'wp', rules: ['STUB_RULE_A'], isWordPress: true, run: () => { ran += 1; } });
  run('<?php\nfunction f() {}\n');
  assert.equal(ran, 0);
});

test('PHP never reaches Babel: Babel-invalid PHP is not a Babel parse error', () => {
  const { violations, coverage } = run('<?php\necho "hi";\n?>\n<p>text</p>\n');
  assert.deepEqual(violations, []);
  assert.equal(coverage.kind, 'ast');
});

test('the shipped pass list: the generic passes, then the WordPress passes', () => {
  const names = DEFAULT_PASSES.map((pass) => pass.name);
  assert.deepEqual(names.slice(0, GENERIC.length), GENERIC);
  assert.ok(DEFAULT_PASSES.slice(0, GENERIC.length).every((pass) => pass.isWordPress !== true));
  const wordpress = DEFAULT_PASSES.slice(GENERIC.length);
  assert.deepEqual(wordpress.map((pass) => pass.name),
    ['wp-public-write-route', 'wp-rest-no-permission', 'wp-read-side-effect', 'wp-nonce', 'wp-sql', 'wp-request-flow', 'wp-output', 'wp-auth-filters']);
  assert.ok(wordpress.every((pass) => pass.isWordPress === true));
  assert.deepEqual(DEFAULT_PASSES.flatMap((pass) => pass.rules).sort(), Object.keys(PHP_RULE_DEFAULTS).sort());
});

test('PHP_DEFAULT_OFF is the reused ids measured under the bar; new ids carry isDefaultOff from RULE_DEFAULTS', () => {
  assert.deepEqual([...PHP_DEFAULT_OFF].sort(), ['CONTROL_FLOW_CASCADE_GUARDS', 'CONTROL_FLOW_SILENT_GUARD', 'UNGUARDED_LOGGING']);
  const newIds = Object.keys(RULE_REVISIONS).filter((rule) => RULE_REVISIONS[rule] === 7);
  assert.equal(newIds.length, 11);
  for (const rule of newIds) {
    assert.ok(PHP_RULE_DEFAULTS[rule], `${rule} has no RULE_DEFAULTS entry`);
    assert.equal(RULE_REGISTRY[rule].isDefaultOff === true, PHP_RULE_DEFAULTS[rule].defaultOn === false, rule);
  }
});

test('a non-WordPress PHP file runs only the generic passes whose rules are on', () => {
  usePasses(spiedPasses());
  const { coverage } = run('<?php\nfunction f() {\n  return 1;\n}\n');
  assert.deepEqual(ranPasses, ['php-metrics', 'php-control-flow', 'php-catch', 'php-dangerous']);
  assert.deepEqual(coverage, { kind: 'ast', language: 'php', reason: null });
});

const probeAfterPasses = (seen) => [...spiedPasses(), { name: 'probe', rules: [], run: (ctx) => { seen.ctx = ctx; } }];

test('a WordPress fixture runs the WordPress passes with ctx.wp and an index that holds the audited file', () => {
  const fixture = PHP_FIXTURES.SECURITY_WP_PUBLIC_WRITE_ROUTE;
  const seen = {};
  usePasses(probeAfterPasses(seen));
  const { violations } = auditCodeDetailed(fixture.bad, fixture.path, fixture.path, { config: fixture.config });
  assert.ok(ranPasses.includes('wp-public-write-route') && ranPasses.includes('wp-nonce'));
  // Passes whose every rule is default-off stay skipped without a setting.
  for (const skipped of ['wp-read-side-effect', 'wp-sql', 'wp-request-flow', 'wp-output']) assert.ok(!ranPasses.includes(skipped), skipped);
  assert.equal(seen.ctx.wp.isWordPress, true);
  assert.ok(seen.ctx.index.files().includes(fixture.path));
  assert.ok(violations.some((v) => v.rule === 'SECURITY_WP_PUBLIC_WRITE_ROUTE'));
});

test('crossFile false keeps ctx.index null: WordPress passes run, the index-backed write-route rule stays silent', () => {
  const fixture = PHP_FIXTURES.SECURITY_WP_PUBLIC_WRITE_ROUTE;
  const seen = {};
  usePasses(probeAfterPasses(seen));
  const { violations } = auditCodeDetailed(fixture.bad, fixture.path, fixture.path, { config: fixture.config, crossFile: false });
  assert.ok(ranPasses.includes('wp-public-write-route'));
  assert.equal(seen.ctx.index, null);
  assert.equal(seen.ctx.crossFile, false);
  assert.ok(!violations.some((v) => v.rule === 'SECURITY_WP_PUBLIC_WRITE_ROUTE'));
});

test('wordpress: false skips every WordPress pass', () => {
  const fixture = PHP_FIXTURES.SECURITY_WP_PUBLIC_WRITE_ROUTE;
  usePasses(spiedPasses());
  const { violations } = auditCodeDetailed(fixture.bad, fixture.path, fixture.path, { config: { ...fixture.config, wordpress: false } });
  assert.ok(!ranPasses.some((name) => name.startsWith('wp-')));
  assert.ok(!violations.some((v) => v.rule.startsWith('SECURITY_WP_')));
});

test('a PHP default-off reused rule is silent without a setting and reported with "on"', () => {
  usePasses(DEFAULT_PASSES);
  const fixture = PHP_FIXTURES.CONTROL_FLOW_SILENT_GUARD;
  const rulesWith = (config) => auditCodeDetailed(fixture.bad, fixture.path, fixture.path, { config }).violations.map((v) => v.rule);
  assert.ok(!rulesWith({ ...fixture.config, rules: {} }).includes('CONTROL_FLOW_SILENT_GUARD'));
  assert.ok(rulesWith(fixture.config).includes('CONTROL_FLOW_SILENT_GUARD'));
});
