import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES_FIXTURES, HEADER, auditFiles, routeFile } from '../fixtures/php/routes.fixtures.js';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { wpRouteRegistrations, wpPublicWriteRoutePass, wpNoPermissionPass, wpReadSideEffectPass, RULE_DEFAULTS } from './wp-route-rules.js';

const WRITE = 'SECURITY_WP_PUBLIC_WRITE_ROUTE';
const NO_PERMISSION = 'SECURITY_WP_REST_NO_PERMISSION_CALLBACK';
const READ = 'SECURITY_WP_PUBLIC_READ_SIDE_EFFECT';

const post = (cb = "'demo_cb'", permission = "'__return_true'", methods = "'POST'") => `array(
		'methods'             => ${methods},
		'callback'            => ${cb},
		'permission_callback' => ${permission},
	)`;
const hits = (args, rest, options) => auditFiles({ 'demo.php': routeFile(args, rest) }, options);
const rules = (found) => found.map((r) => r.rule);

test('fixture pairs: bad fires once at its anchor line, good is silent under every route pass', () => {
  const anchors = { [WRITE]: 10, [NO_PERMISSION]: 7, [READ]: 9 };
  for (const [id, pair] of Object.entries(ROUTES_FIXTURES)) {
    const bad = auditFiles({ 'demo.php': pair.bad });
    assert.deepEqual(bad.map((r) => [r.rule, r.line]), [[id, anchors[id]]], id);
    assert.deepEqual(auditFiles({ 'demo.php': pair.good }), [], id);
  }
});

test('the write rule is MEDIUM, names the effect, and is not crossFile in one file', () => {
  const [hit] = auditFiles({ 'demo.php': ROUTES_FIXTURES[WRITE].bad });
  assert.equal(hit.severity, 'MEDIUM');
  assert.equal(hit.crossFile, false);
  assert.match(hit.hazard, /update_option\(\) at demo\.php:\d+/);
  assert.match(hit.evidence, /demo_save at demo\.php:/);
});

test('write verbs from constants and arrays fire; read verbs and a missing methods key do not', () => {
  const write = (methods) => hits(post("'demo_cb'", "'__return_true'", methods), "function demo_cb() { update_option( 'a', 1 ); }").filter((r) => r.rule === WRITE);
  for (const methods of ["WP_REST_Server::CREATABLE", "'PUT'", "'GET, DELETE'", 'WP_REST_Server::ALLMETHODS', "array( WP_REST_Server::READABLE, 'PATCH' )"]) {
    assert.deepEqual(rules(write(methods)), [WRITE], methods);
  }
  assert.deepEqual(write("'GET'"), []);
  assert.deepEqual(write('WP_REST_Server::READABLE'), []);
  assert.deepEqual(write('$unknown'), []);
});

test('public permission shapes: closure, arrow function, and a callable whose body is only return true', () => {
  const rest = "function demo_cb() { update_option( 'a', 1 ); }";
  assert.deepEqual(rules(hits(post("'demo_cb'", 'function () { return true; }'), rest)), [WRITE]);
  assert.deepEqual(rules(hits(post("'demo_cb'", 'fn() => true'), rest)), [WRITE]);
  assert.deepEqual(hits(post("'demo_cb'", "'demo_can'"), `${rest}\nfunction demo_can() { return current_user_can( 'edit_posts' ); }`), []);
  assert.deepEqual(rules(hits(post("'demo_cb'", "'demo_open'"), `${rest}\nfunction demo_open() { return true; }`)), [WRITE]);
});

test('quests style: check_permission() returning true fires through the callable, the finding sits on the permission line', () => {
  const code = `${HEADER}class Demo_Rest {
	public function register() {
		register_rest_route( 'demo/v1', '/items', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'create_item' ),
			'permission_callback' => array( $this, 'check_permission' ),
		) );
	}
	public function check_permission() {
		return true;
	}
	public function create_item() {
		wp_insert_post( array( 'post_title' => 'Demo' ) );
	}
}
`;
  const found = auditFiles({ 'demo.php': code });
  assert.deepEqual(found.map((r) => [r.rule, r.line]), [[WRITE, 10]]);
});

test('auth-like calls in the callback, or two hops down, keep the write rule silent', () => {
  const guards = [
    "if ( ! current_user_can( 'manage_options' ) ) { return null; }",
    'if ( ! get_current_user_id() ) { return null; }',
    'if ( ! hash_equals( 1, 2 ) ) { return null; }',
    "if ( ! wp_verify_nonce( 'a', 'b' ) ) { return null; }",
    'if ( ! $this->verify_signature() ) { return null; }',
    '$this->handle_registration();',
  ];
  for (const guard of guards) {
    const code = `class Demo_Rest {\n\tpublic function create() {\n\t\t${guard}\n\t\tupdate_option( 'a', 1 );\n\t}\n}`;
    const args = post("array( \$this, 'create' )");
    assert.deepEqual(hits(args, code), [], guard);
  }
  const deep = "function demo_cb() { demo_one(); }\nfunction demo_one() { demo_two(); }\nfunction demo_two() { if ( ! current_user_can( 'x' ) ) { return; } }\nfunction demo_write() { update_option( 'a', 1 ); }";
  assert.deepEqual(hits(post(), `${deep}`.replace('demo_one(); }', 'demo_one(); demo_write(); }')), []);
});

test('effects are found within 2 hops and not at 3', () => {
  const chain = (depth) => Array.from({ length: depth }, (_, i) => `function demo_${i ? `h${i}` : 'cb'}() { ${i + 1 < depth ? `demo_h${i + 1}();` : "update_option( 'a', 1 );"} }`).join('\n');
  assert.deepEqual(rules(hits(post(), chain(3))), [WRITE]);
  assert.deepEqual(hits(post(), chain(4)), []);
});

test('callbacks that only log out are exempt; logout plus another write is not', () => {
  assert.deepEqual(hits(post(), 'function demo_cb() { wp_logout(); }'), []);
  assert.deepEqual(rules(hits(post(), "function demo_cb() { wp_logout(); update_option( 'a', 1 ); }")), [WRITE]);
});

test('an outbound request counts as an effect; a callback with no effect does not fire', () => {
  assert.deepEqual(rules(hits(post(), "function demo_cb() { wp_remote_post( 'https://example.test' ); }")), [WRITE]);
  assert.deepEqual(hits(post(), 'function demo_cb() { return array(); }'), []);
});

test('a callback that does not resolve is silent', () => {
  assert.deepEqual(hits(post("'demo_missing'"), ''), []);
});

test('missing permission_callback: fires at the endpoint array; the core controller shape and a variable shape stay silent', () => {
  assert.deepEqual(hits("array( 'methods' => 'GET', 'callback' => 'demo_cb' )", '').map((r) => [r.rule, r.line]), [[NO_PERMISSION, 7]]);
  const list = `array(
		array( 'methods' => 'GET', 'callback' => 'demo_cb', 'permission_callback' => '__return_true' ),
		array( 'methods' => 'POST', 'callback' => 'demo_cb' ),
		'schema' => 'demo_schema',
	)`;
  assert.deepEqual(hits(list, '').map((r) => [r.rule, r.line]), [[NO_PERMISSION, 9]]);
  const variable = `${HEADER}function demo_register() {
	$args = array( 'methods' => 'GET', 'callback' => 'demo_cb', 'permission_callback' => '__return_true' );
	register_rest_route( 'demo/v1', '/x', $args );
}
`;
  assert.deepEqual(auditFiles({ 'demo.php': variable }), []);
});

test('read side effect: the finding names the effect and sits on the callback line', () => {
  const args = post("'demo_cb'", "'__return_true'", "'GET'");
  const found = hits(args, "function demo_cb() { demo_touch(); }\nfunction demo_touch() { set_transient( 'a', 1 ); }");
  assert.deepEqual(found.map((r) => [r.rule, r.line]), [[READ, 9]]);
  assert.match(found[0].hazard, /set_transient\(\) at demo\.php:\d+/);
  assert.deepEqual(hits(args, "function demo_cb() { return get_option( 'a' ); }"), []);
});

test('read side effect needs a public permission and no write verb', () => {
  const rest = "function demo_cb() { update_option( 'a', 1 ); }";
  assert.deepEqual(hits(post("'demo_cb'", "'demo_can'", "'GET'"), `${rest}\nfunction demo_can() { return current_user_can( 'x' ); }`), []);
  assert.deepEqual(rules(hits(post("'demo_cb'", "'__return_true'", "'GET'"), rest)), [READ]);
  assert.deepEqual(rules(hits(post("'demo_cb'", "'__return_true'", 'WP_REST_Server::READABLE'), rest)), [READ]);
});

test('cross-file effects: crossFile true with the other file named; crossFile false drops them', () => {
  const files = {
    'demo.php': routeFile(post("array( 'Demo_Store', 'save' )", "'__return_true'", "'POST'")),
    'includes/store.php': "<?php\nclass Demo_Store {\n\tpublic static function save() {\n\t\tupdate_option( 'a', 1 );\n\t}\n}\n",
  };
  const [hit] = auditFiles(files);
  assert.equal(hit.rule, WRITE);
  assert.equal(hit.file, 'demo.php');
  assert.equal(hit.crossFile, true);
  assert.match(hit.evidence, /includes\/store\.php:4/);
  assert.deepEqual(auditFiles(files, { crossFile: false }), []);
});

test('passes stay silent outside WordPress; without an index only the missing-permission rule runs', () => {
  const code = routeFile("array( 'methods' => 'POST', 'callback' => 'demo_cb' )", "function demo_cb() { update_option( 'a', 1 ); }");
  const run = (pass, options) => {
    const ctx = buildPassContext(code, options);
    pass(ctx);
    return ctx.records.map((r) => r.rule);
  };
  assert.deepEqual(run(wpNoPermissionPass, { wp: { isWordPress: false } }), []);
  assert.deepEqual(run(wpNoPermissionPass, {}), []);
  assert.deepEqual(run(wpNoPermissionPass, { wp: { isWordPress: true, root: '/x', kind: 'plugin' } }), [NO_PERMISSION]);
  const open = routeFile(post(), "function demo_cb() { update_option( 'a', 1 ); }");
  const indexless = (pass) => {
    const ctx = buildPassContext(open, { wp: { isWordPress: true, root: '/x', kind: 'plugin' } });
    pass(ctx);
    return ctx.records;
  };
  assert.deepEqual(indexless(wpPublicWriteRoutePass), []);
  assert.deepEqual(indexless(wpReadSideEffectPass), []);
});

test('registrations: one WordPress-only entry per rule, defaults declared, and read side effect ships off', () => {
  assert.deepEqual(wpRouteRegistrations.map((r) => r.rules), [[WRITE], [NO_PERMISSION], [READ]]);
  assert.ok(wpRouteRegistrations.every((r) => r.isWordPress === true && typeof r.run === 'function'));
  assert.equal(RULE_DEFAULTS[READ].defaultOn, false);
  assert.ok([WRITE, NO_PERMISSION, READ].every((id) => id in RULE_DEFAULTS));
});
