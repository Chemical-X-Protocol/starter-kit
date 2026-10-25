import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { REQUEST_FLOW_FIXTURES } from '../fixtures/php/request-flow.fixtures.js';
import { applyRuleOverrides } from '../audit/rule-overrides.js';
import { wpOutputPass, wpOutputRegistration, RULE_DEFAULTS } from './wp-output.js';

const RULE = 'SECURITY_WP_UNESCAPED_OUTPUT';
const WP = { isWordPress: true, root: null, kind: 'plugin' };
const DEFAULT_OFF = new Set([RULE]);
const wrap = (body) => `<?php\nfunction demo( $label, $request ) {\n${body}\n}\n`;

function records(code, options = {}) {
  const ctx = buildPassContext(code, { wp: WP, ...options });
  wpOutputPass(ctx);
  return ctx.records;
}

const fires = (body) => records(wrap(body)).length;

test('fixture pair: bad fires, good is silent', () => {
  const fixture = REQUEST_FLOW_FIXTURES[RULE];
  const options = { path: fixture.path, config: fixture.config };
  assert.deepEqual(records(fixture.bad, options).map((r) => r.rule), [RULE]);
  assert.deepEqual(records(fixture.good, options), []);
});

test('registration and defaults: WordPress only, default off', () => {
  assert.deepEqual(wpOutputRegistration.rules, [RULE]);
  assert.equal(wpOutputRegistration.isWordPress, true);
  assert.equal(RULE_DEFAULTS[RULE].defaultOn, false);
  const ctx = buildPassContext(wrap('echo $label;'));
  wpOutputPass(ctx);
  assert.deepEqual(ctx.records, []);
});

test('with the rule on: a request-derived echo is HIGH and a plain one MEDIUM', () => {
  const config = { rules: { [RULE]: 'on' }, overrides: [], wordpress: true };
  const request = records(wrap(`$q = $request->get_param( 'q' ); echo $q;`));
  const plain = records(wrap('echo $label;'));
  const superglobal = records(wrap(`echo $_GET['q'];`));
  const settled = (list) => applyRuleOverrides(list.map((r) => ({ ...r, filePath: 'demo.php' })), 'demo.php', config, { defaultOff: DEFAULT_OFF });
  assert.deepEqual(settled(request).map((v) => v.severity), ['HIGH']);
  assert.deepEqual(settled(superglobal).map((v) => v.severity), ['HIGH']);
  assert.deepEqual(settled(plain).map((v) => v.severity), ['MEDIUM']);
});

test('default-off: no setting drops the finding; a severity setting overwrites it', () => {
  const found = records(wrap('echo $label;')).map((r) => ({ ...r, filePath: 'demo.php' }));
  assert.equal(found.length, 1);
  assert.deepEqual(applyRuleOverrides(found, 'demo.php', { rules: {}, overrides: [] }, { defaultOff: DEFAULT_OFF }), []);
  const lowered = applyRuleOverrides(records(wrap(`echo $_GET['q'];`)), 'demo.php', { rules: { [RULE]: 'low' } }, { defaultOff: DEFAULT_OFF });
  assert.deepEqual(lowered.map((v) => v.severity), ['LOW']);
});

test('echo, print and <?= statements fire once each', () => {
  assert.equal(fires('echo $label;'), 1);
  assert.equal(fires('print $label;'), 1);
  assert.equal(fires('echo $label, $request;'), 1);
  assert.equal(records('<?php function demo( $label ) { ?><p><?= $label ?></p><?php } ?>').length, 1);
  assert.equal(fires(`echo '<p>' . $label . '</p>';`), 1);
  assert.equal(fires(`echo "<p>{$label}</p>";`), 1);
  assert.equal(fires('echo $label->name;'), 1);
  assert.equal(fires('echo get_option( "k" );'), 1);
  assert.equal(fires('echo __( "Text", "demo" );'), 1);
  assert.equal(fires('echo $label ? $label : "x";'), 1);
});

test('silent: literals, constants, numeric casts, arithmetic, escapers and ID properties', () => {
  const silent = [
    `echo 'text';`, `echo "text";`, `echo 42;`, `echo PHP_EOL;`, `echo DEMO_VERSION;`, `echo Demo::VERSION;`,
    `echo (int) $label;`, `echo $label + 1;`, `echo $label === 'a';`, `echo -$label;`, `echo ! $label;`,
    `echo esc_html( $label );`, `echo esc_attr( $label );`, `echo esc_url( $label );`, `echo wp_kses_post( $label );`,
    `echo absint( $label );`, `echo '<a href="' . esc_url( $label ) . '">' . esc_html( $label ) . '</a>';`,
    `echo "<p>" . esc_html( $label ) . "</p>";`, `echo $label->ID;`, `echo wp_json_encode( $label );`,
    `echo date( 'Y' );`, `echo $label ? 'a' : 'b';`, `echo isset( $label ) ? 'a' : 'b';`,
  ];
  for (const body of silent) assert.equal(fires(body), 0, body);
});

test('silent: a function that sends a non-HTML Content-Type', () => {
  assert.equal(fires(`header( 'Content-Type: application/json' ); echo $label;`), 0);
  assert.equal(fires(`header( 'Content-Type: text/csv; charset=utf-8' ); echo $label;`), 0);
  assert.equal(fires(`header( 'Content-Type: text/html' ); echo $label;`), 1);
});

test('echo inside a nested closure is judged in the closure scope', () => {
  const code = wrap(`$q = $_GET['q']; add_action( 'x', function () use ( $label ) { echo $label; } );`);
  const list = records(code);
  assert.deepEqual(list.map((r) => r.severity), ['MEDIUM']);
});
