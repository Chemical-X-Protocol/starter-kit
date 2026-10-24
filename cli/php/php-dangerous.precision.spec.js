import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { runDangerousPass } from './php-dangerous.js';

// Section 8.3: one minimal snippet per labelled hit shape. `weight` is the number of labelled hits the case
// stands for. TP must fire `rule`; FP must stay silent unless `known: 'FP'` (a documented false positive).
const wrap = (body) => `<?php\nfunction demo( $param ) {\n${body}\n}\n`;

const CORPUS = [
  { label: 'FP', origin: 'xophz-compass/includes/class-xophz-compass-integrations.php:573', weight: 1, code: wrap(`foreach ( $metas as $m ) { $v = maybe_unserialize( $m->meta_value ); }`) },
  { label: 'FP', origin: 'xophz-compass/includes/class-xophz-compass-integrations.php:644', weight: 1, code: wrap(`foreach ( $metas as $m ) { $v = maybe_unserialize( $m->meta_value ); }`) },
  { label: 'FP', origin: 'xophz-compass-alphabet-soup/includes/class-xophz-compass-alphabet-soup-api.php:195', weight: 1, code: wrap(`foreach ( get_post_meta( $param ) as $key => $values ) { foreach ( $values as $value ) { add_post_meta( 1, $key, maybe_unserialize( $value ) ); } }`) },
  { label: 'FP', origin: 'xophz-compass-silver-arrow/public/class-xophz-compass-silver-arrow-public.php:342', weight: 2, code: wrap(`$meta_val = $archive[ $param ]; return is_array( $meta_val ) && isset( $meta_val[0] ) ? maybe_unserialize( $meta_val[0] ) : maybe_unserialize( $meta_val );`) },
  { label: 'FP', origin: 'xophz-compass-silver-arrow/public/class-xophz-compass-silver-arrow-public.php:344', weight: 1, code: wrap(`return is_array( $param ) ? array_map( 'maybe_unserialize', $param ) : array( maybe_unserialize( $param ) );`) },
  { label: 'FP', origin: 'xophz-compass-silver-arrow/public/class-xophz-compass-silver-arrow-public.php:350', weight: 1, code: wrap(`foreach ( $archive as $k => $v ) { $out[ $k ] = is_array( $v ) ? array_map( 'maybe_unserialize', $v ) : array( maybe_unserialize( $v ) ); }`) },
  { label: 'FP', origin: 'xophz-compass-silver-arrow/public/class-xophz-compass-silver-arrow-public.php:368', weight: 1, code: wrap(`$raw = get_post_meta( $param ); return maybe_unserialize( $raw[0] );`) },
  { label: 'FP', origin: 'xophz-compass-silver-arrow/public/class-xophz-compass-silver-arrow-public.php:381', weight: 1, code: wrap(`foreach ( $rows as $row ) { $grouped[ $row->meta_key ][] = maybe_unserialize( $row->meta_value ); }`) },
  { label: 'TP', origin: 'xophz-compass-enchiridion/includes/class-xophz-compass-enchiridion-executor.php:148', weight: 1, rule: 'SECURITY_DYNAMIC_CODE_EXECUTION', code: wrap(`if ( is_callable( $param ) ) { call_user_func( $param ); } else { eval( $param ); }`) },
  { label: 'TP', origin: 'xophz-compass-moving-castle/includes/api-traits/trait-moving-castle-api-import.php:67', weight: 1, rule: 'SECURITY_PHP_OBJECT_INJECTION', code: wrap(`if ( is_string( $param ) && ( $unserialized = @unserialize( $param ) ) !== false ) { $param = $unserialized; }`) },
];

// Held-out hits that fire (H2, git-ignored plugins read-only, vendor/ excluded, measured 2026-10-24 at PHP 8.3).
// Labels judge the construct only: code, a command or an unserialize built or read at runtime. They do not
// judge exploitability, and most of these sit in bundled libraries.
const HELD_OUT_FIRING = [
  { label: 'TP', origin: 'snapshot-backups/lib/snapshot/helper/class-system.php:113', weight: 3, rule: 'SECURITY_PHP_COMMAND_EXECUTION', code: wrap(`exec( $param, $output, $status );`) },
  { label: 'TP', origin: 'forminator/.../google/auth/src/CredentialsLoader.php:193', weight: 5, rule: 'SECURITY_PHP_COMMAND_EXECUTION', code: wrap(`\\exec( $param, $output, $code );`) },
  { label: 'TP', origin: 'wp-defender/lib/packages/Symfony/Component/Process/Process.php:353', weight: 11, rule: 'SECURITY_PHP_COMMAND_EXECUTION', code: wrap(`$process = @proc_open( $param, $descriptors, $pipes );`) },
  { label: 'TP', origin: 'wp-defender/extra/hub-connector/lib/PHPSecLib/Crypt/RSA.php:658', weight: 4, rule: 'SECURITY_PHP_OBJECT_INJECTION', code: wrap(`extract( unserialize( $param ) );`) },
  { label: 'TP', origin: 'forminator/library/lib/action-scheduler/classes/data-stores/ActionScheduler_DBStore.php:397', weight: 3, rule: 'SECURITY_PHP_OBJECT_INJECTION', code: wrap(`$schedule = unserialize( $data->schedule );`) },
  { label: 'TP', origin: 'forminator/.../phpseclib/Math/BigInteger/Engines/BCMath/Reductions/EvalBarrett.php:57', weight: 8, rule: 'SECURITY_DYNAMIC_CODE_EXECUTION', code: wrap(`eval( '$func = function ($n) { ' . $param . '};' );`) },
  { label: 'TP', origin: 'code-snippets/php/snippet-ops.php:822', weight: 2, rule: 'SECURITY_DYNAMIC_CODE_EXECUTION', code: wrap(`$result = eval( $param );`) },
  { label: 'TP', origin: 'wp-defender/lib/packages/Safe/generated/funchand.php:20', weight: 1, rule: 'SECURITY_DYNAMIC_CODE_EXECUTION', code: wrap(`$result = \\create_function( $param, $code );`) },
  { label: 'FP', known: 'FP', origin: 'forminator/admin/pages/integrations-page.php:230', weight: 1, code: wrap(`$callback = $addon->get_section_callback( $_GET['section'] ); call_user_func( $callback, $args );`) },
];

// The 20 third-party assert hits (PHP 8 code: assert() never evaluates strings). All stay silent at 8.3 and 7.4.
const ASSERT = [
  ['wp-defender/lib/packages/Brick/Math/BigInteger.php:1087', 1, `assert( $bin !== false );`],
  ['wp-defender/lib/packages/Brick/Math/BigNumber.php:93', 1, `assert( $denominator !== null );`],
  ['wp-defender/lib/packages/Brick/Math/Internal/Calculator/BcMathCalculator.php:81', 2, `assert( $q !== null ); assert( $r !== null );`],
  ['wp-defender/lib/packages/Brick/Math/Internal/Calculator/NativeCalculator.php:189', 1, `assert( is_int( $q ) );`],
  ['wp-defender/lib/packages/Brick/Math/Internal/Calculator/NativeCalculator.php:435', 1, `assert( $carry === 0 );`],
  ['wp-defender/lib/packages/FG/ASN1/ExplicitlyTaggedObject.php:107', 2, `assert( Demo::isClass( $octet ), 'octet should indicate a class' ); assert( Demo::isConstructed( $octet ), 'octet should be constructed' );`],
  ['wp-defender/lib/packages/FG/ASN1/Universal/Integer.php:83', 1, `assert( $i != $count - 1 );`],
  ['wp-defender/lib/packages/Ramsey/Uuid/FeatureSet.php:104', 1, `assert( $this->provider !== null );`],
  ['wp-defender/lib/packages/Ramsey/Uuid/Generator/UnixTimeGenerator.php:89', 1, `assert( strlen( $time ) === 6 );`],
  ['wp-defender/lib/packages/Ramsey/Uuid/Lazy/LazyUuidFromString.php:264', 9, `assert( $fields instanceof \\Demo\\FieldsInterface );`],
].map(([origin, weight, body]) => ({ label: 'FP', origin, weight, heldOut: true, code: wrap(body) }));

function firedRules(code, version) {
  const config = { rules: {}, overrides: [], wordpress: true, php: { version } };
  const ctx = buildPassContext(code, { config });
  runDangerousPass(ctx);
  return ctx.records.map((record) => record.rule);
}

function classify(item, version = '8.3') {
  const fired = firedRules(item.code, version);
  const isTp = item.label === 'TP';
  const detected = isTp ? fired.includes(item.rule) : fired.length > 0;
  return { fired, detected };
}

function weightedPrecision(items) {
  let truePositive = 0;
  let falsePositive = 0;
  for (const item of items) {
    const { detected } = classify(item);
    if (!detected) continue;
    const isTp = item.label === 'TP';
    truePositive += isTp ? item.weight : 0;
    falsePositive += isTp ? 0 : item.weight;
  }
  const reported = truePositive + falsePositive;
  return reported === 0 ? 1 : truePositive / reported;
}

test('corpus: every TP fires, every FP stays silent', () => {
  for (const item of CORPUS) {
    const { detected } = classify(item);
    const expected = item.label === 'TP';
    assert.equal(detected, expected, `${item.label} ${item.origin}`);
  }
});

test('corpus: weights sum to the 11 labelled hits, precision at least 80%', () => {
  const total = CORPUS.reduce((sum, item) => sum + item.weight, 0);
  assert.equal(total, 11);
  assert.ok(weightedPrecision(CORPUS) >= 0.8);
  const silentWeight = CORPUS.filter((item) => item.label === 'FP').reduce((sum, item) => sum + item.weight, 0);
  assert.equal(silentWeight, 9);
});

test('held-out firing hits: 38 labelled, weighted precision at least 80%', () => {
  const total = HELD_OUT_FIRING.reduce((sum, item) => sum + item.weight, 0);
  assert.equal(total, 38);
  for (const item of HELD_OUT_FIRING) {
    const { detected } = classify(item);
    const expected = item.label === 'TP' || Boolean(item.known);
    assert.equal(detected, expected, `${item.label} ${item.origin}`);
  }
  assert.ok(weightedPrecision(HELD_OUT_FIRING) >= 0.8);
});

test('held-out assert shapes: 20 labelled hits, all silent at PHP 8.3 and 7.4', () => {
  const total = ASSERT.reduce((sum, item) => sum + item.weight, 0);
  assert.equal(total, 20);
  for (const item of ASSERT) {
    assert.deepEqual(classify(item, '8.3').fired, [], `8.3 ${item.origin}`);
    assert.deepEqual(classify(item, '7.4').fired, [], `7.4 ${item.origin}`);
  }
  assert.ok(weightedPrecision(ASSERT) >= 0.8);
});
