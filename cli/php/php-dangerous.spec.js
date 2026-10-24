import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { DANGEROUS_FIXTURES } from '../fixtures/php/dangerous.fixtures.js';
import { runDangerousPass, RULE_DEFAULTS } from './php-dangerous.js';

function run(code, version) {
  const config = version ? { rules: {}, overrides: [], wordpress: true, php: { version } } : undefined;
  const ctx = buildPassContext(code, config ? { config } : {});
  runDangerousPass(ctx);
  return ctx.records.map((record) => record.rule);
}

const wrap = (body) => `<?php\nfunction demo( $param ) {\n${body}\n}\n`;

test('every fixture pair: bad fires its rule, good is silent', () => {
  for (const [rule, fixture] of Object.entries(DANGEROUS_FIXTURES)) {
    assert.ok(run(fixture.bad).includes(rule), `${rule} bad`);
    assert.deepEqual(run(fixture.good), [], `${rule} good`);
  }
});

test('RULE_DEFAULTS covers the three ids', () => {
  assert.deepEqual(Object.keys(RULE_DEFAULTS).sort(), Object.keys(DANGEROUS_FIXTURES).sort());
});

test('dynamic code execution: eval, create_function, preg_replace /e', () => {
  const rule = 'SECURITY_DYNAMIC_CODE_EXECUTION';
  assert.deepEqual(run(wrap(`eval( $param );`)), [rule]);
  assert.deepEqual(run(wrap(`eval( 'return ' . $param . ';' );`)), [rule]);
  assert.deepEqual(run(wrap(`eval( 'return 1;' );`)), []);
  assert.deepEqual(run(wrap(`$f = create_function( '$a', 'return $a;' );`)), [rule]);
  assert.deepEqual(run(wrap(`preg_replace( '/x/e', 'strtoupper("$0")', $param );`)), [rule]);
  assert.deepEqual(run(wrap(`preg_replace( '#x#ie', 'y', $param );`)), [rule]);
  assert.deepEqual(run(wrap(`preg_replace( '/x/i', 'y', $param );`)), []);
  assert.deepEqual(run(wrap(`preg_replace( '/e/', 'y', $param );`)), []);
  assert.deepEqual(run(wrap(`preg_replace_callback( '/x/', 'demo_cb', $param );`)), []);
});

test('assert fires only below PHP 8 and only for string or encapsed arguments', () => {
  const rule = 'SECURITY_DYNAMIC_CODE_EXECUTION';
  assert.deepEqual(run(wrap(`assert( 'code' );`), '7.4'), [rule]);
  assert.deepEqual(run(wrap(`assert( "code $param" );`), '7.4'), [rule]);
  assert.deepEqual(run(wrap(`assert( 'code' );`), '8.3'), []);
  assert.deepEqual(run(wrap(`assert( 'code' );`)), []);
  assert.deepEqual(run(wrap(`assert( $param !== false );`), '7.4'), []);
  assert.deepEqual(run(wrap(`assert( $param );`), '7.4'), []);
  assert.deepEqual(run(wrap(`assert( $param !== false );`), '8.3'), []);
});

test('object injection: unserialize without allowed_classes', () => {
  const rule = 'SECURITY_PHP_OBJECT_INJECTION';
  assert.deepEqual(run(wrap(`unserialize( $param );`)), [rule]);
  assert.deepEqual(run(wrap(`@unserialize( $param );`)), [rule]);
  assert.deepEqual(run(wrap(`unserialize( $param, array() );`)), [rule]);
  assert.deepEqual(run(wrap(`unserialize( $param, [ 'allowed_classes' => false ] );`)), []);
  assert.deepEqual(run(wrap(`unserialize( $param, array( 'allowed_classes' => array( 'Demo' ) ) );`)), []);
  assert.deepEqual(run(wrap(`unserialize( $param, $options );`)), []);
});

test('object injection: request-derived arguments only', () => {
  const rule = 'SECURITY_PHP_OBJECT_INJECTION';
  assert.deepEqual(run(wrap(`maybe_unserialize( $_POST['x'] );`)), [rule]);
  assert.deepEqual(run(wrap(`$v = $request->get_param( 'x' ); maybe_unserialize( $v );`)), [rule]);
  assert.deepEqual(run(wrap(`maybe_unserialize( $param );`)), []);
  assert.deepEqual(run(wrap(`maybe_unserialize( get_post_meta( 1, 'k', true ) );`)), []);
  assert.deepEqual(run(wrap(`extract( $_POST );`)), [rule]);
  assert.deepEqual(run(wrap(`extract( $param );`)), []);
  assert.deepEqual(run(wrap(`call_user_func( $_GET['cb'] );`)), [rule]);
  assert.deepEqual(run(wrap(`call_user_func_array( $_GET['cb'], array() );`)), [rule]);
  assert.deepEqual(run(wrap(`call_user_func( 'demo_cb', $_GET['x'] );`)), []);
  assert.deepEqual(run(wrap(`include $_GET['page'];`)), [rule]);
  assert.deepEqual(run(wrap(`require_once __DIR__ . '/' . $_GET['page'] . '.php';`)), [rule]);
  assert.deepEqual(run(wrap(`include __DIR__ . '/view.php';`)), []);
  assert.deepEqual(run(wrap(`include $param;`)), []);
  assert.deepEqual(run(wrap(`include sanitize_key( $_GET['page'] ) . '.php';`)), []);
});

test('command execution: shell functions and backticks', () => {
  const rule = 'SECURITY_PHP_COMMAND_EXECUTION';
  for (const fn of ['shell_exec', 'exec', 'system', 'passthru', 'proc_open', 'popen', 'pcntl_exec']) {
    assert.deepEqual(run(wrap(`${fn}( $param );`)), [rule], fn);
  }
  assert.deepEqual(run(wrap('$out = `ls $param`;')), [rule]);
  assert.deepEqual(run(wrap('$out = `git branch -v`;')), []);
  assert.deepEqual(run(wrap(`shell_exec( 'id -u' );`)), []);
  assert.deepEqual(run(wrap(`exec( 'ls ' . escapeshellarg( $param ) );`)), [rule]);
  assert.deepEqual(run(wrap(`passthru( "ls $param" );`)), [rule]);
  assert.deepEqual(run(wrap(`$wpdb->exec( 'x' ); $this->exec( 'y' ); Demo::system( 'z' );`)), []);
  assert.deepEqual(run(wrap(`$s = "ls $param";`)), []);
});

test('findings are anchored on the sink line', () => {
  const ctx = buildPassContext(`<?php\n\nfunction demo( $c ) {\n\neval( $c );\n}\n`);
  runDangerousPass(ctx);
  assert.equal(ctx.records.length, 1);
  assert.equal(ctx.records[0].line, 5);
});
