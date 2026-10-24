import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { auditCodeDetailed } from '../audit/rules.js';
import { RULE_REGISTRY } from '../audit/rules-registry.js';
import { PASSES } from './php-analyzer.js';
import { setPhpParserLoader, clearPhpParseCache } from './php-parse.js';

const PATH = '/p/plugin/a.php';
const REL = 'plugin/a.php';
const run = (src, options = {}, rel = REL) => auditCodeDetailed(src, '/p/' + rel, rel, options);

beforeEach(() => {
  setPhpParserLoader(null);
  clearPhpParseCache();
  PASSES.length = 0;
});
afterEach(() => {
  setPhpParserLoader(null);
  PASSES.length = 0;
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

test('a pass-supplied severity wins and an unregistered id is kept', () => {
  PASSES.push({ name: 'stub', rules: [], run: (ctx) => ctx.report('STUB_UNREGISTERED_RULE', 1, 'x', { severity: 'HIGH' }) });
  const { violations } = run('<?php\nfunction f() {}\n');
  const v = violations.find((x) => x.rule === 'STUB_UNREGISTERED_RULE');
  assert.equal(v.severity, 'HIGH');
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
