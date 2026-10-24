import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { CATCH_FIXTURES } from '../fixtures/php/catch.fixtures.js';
import { loggingPass, RULE_DEFAULTS } from './php-logging.js';

const run = (code) => {
  const ctx = buildPassContext(code);
  loggingPass(ctx);
  return ctx.records;
};
const inFn = (body) => `<?php\nfunction demo( $x ) {\n    ${body}\n}\n`;

test('dump functions report UNGUARDED_LOGGING at the call line', () => {
  for (const call of ['var_dump($x)', 'dd($x)', 'dump($x)', 'debug_print_backtrace()', 'debug_zval_dump($x)', 'print_r($x)', 'var_export($x)', 'print_r($x, false)']) {
    const records = run(inFn(`${call};`));
    assert.deepEqual(records.map((r) => [r.rule, r.line]), [['UNGUARDED_LOGGING', 3]], call);
  }
});

test('print_r and var_export in return mode are silent', () => {
  assert.deepEqual(run(inFn('$s = print_r($x, true);')), []);
  assert.deepEqual(run(inFn('$s = var_export($x, true);')), []);
});

test('plain error_log without error wording reports; wording silences it', () => {
  assert.equal(run(inFn('error_log("Demo synced items");')).length, 1);
  assert.deepEqual(run(inFn('error_log("Demo sync failed: " . $x);')), []);
  assert.deepEqual(run(inFn('error_log("Could not reach demo");')), []);
});

test('error_log inside a catch or an error-ish branch is silent', () => {
  assert.deepEqual(run(inFn('try { work(); } catch (Exception $e) { error_log("Demo step"); cleanup(); }')), []);
  assert.deepEqual(run(inFn('if ( is_wp_error( $x ) ) { error_log("Demo step"); }')), []);
  assert.deepEqual(run(inFn('if ( ! $x->success ) { error_log("Demo step"); }')), []);
});

test('error_log guarded by WP_DEBUG is silent, including an early return guard', () => {
  assert.deepEqual(run(inFn('if ( WP_DEBUG ) { error_log("Demo step"); }')), []);
  assert.deepEqual(run(inFn('if ( defined("WP_DEBUG") && WP_DEBUG ) { error_log("Demo step"); }')), []);
  assert.deepEqual(run(inFn('WP_DEBUG && error_log("Demo step");')), []);
  assert.deepEqual(run(inFn('if ( ! WP_DEBUG ) { return; }\n    error_log("Demo step");')), []);
});

test('methods named like logging functions are not reported', () => {
  assert.deepEqual(run(inFn('$this->dump($x); Demo::var_dump($x); $o->error_log("Demo step");')), []);
});

test('the fixture pair behaves and RULE_DEFAULTS names the rule', () => {
  const pair = CATCH_FIXTURES.UNGUARDED_LOGGING;
  assert.equal(run(pair.bad).length, 1);
  assert.deepEqual(run(pair.good), []);
  assert.equal(RULE_DEFAULTS.UNGUARDED_LOGGING.defaultOn, false);
  assert.equal(RULE_DEFAULTS.UNGUARDED_LOGGING.heldOut, '1/10');
});
