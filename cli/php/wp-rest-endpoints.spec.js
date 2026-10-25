import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HEADER, writePlugin } from '../fixtures/php/routes.fixtures.js';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { getProjectIndex } from './wp-project-index.js';
import { resolveRestRoutes } from './wp-rest-endpoints.js';

function resolve(files, { file = 'demo.php', crossFile = true, withIndex = true } = {}) {
  const plugin = writePlugin(files);
  try {
    const index = withIndex ? getProjectIndex(plugin.root) : null;
    const wp = { isWordPress: true, root: plugin.root, kind: 'plugin' };
    const ctx = buildPassContext(fs.readFileSync(path.join(plugin.root, file), 'utf8'), { path: path.join(plugin.root, file), index, wp, crossFile });
    ctx.relativePath = file;
    return resolveRestRoutes(ctx);
  } finally {
    plugin.cleanup();
  }
}

const one = (body, rest = '', options) => resolve({ 'demo.php': `${HEADER}register_rest_route( 'demo/v1', '/x', ${body} );\n${rest}` }, options)[0];
const verbs = (body, rest = '') => one(`array( 'callback' => 'demo_cb', 'permission_callback' => '__return_true', ${body} )`, rest).endpoints[0].methods;

test('single shape: callback at the top level makes one endpoint; top-level args stays out', () => {
  const route = one("array( 'methods' => 'POST', 'callback' => 'demo_cb', 'permission_callback' => '__return_true', 'args' => array() )", 'function demo_cb() {}');
  assert.equal(route.namespace, 'demo/v1');
  assert.equal(route.route, '/x');
  assert.equal(route.endpoints.length, 1);
  assert.equal(route.endpoints[0].shape, 'single');
  assert.equal(route.endpoints[0].callback.target.id, 'demo_cb');
});

test('list shape: only numeric keys are endpoints; args and schema are skipped', () => {
  const route = one(`array(
    'args' => array( 'id' => array() ),
    array( 'methods' => 'GET', 'callback' => 'demo_cb', 'permission_callback' => '__return_true' ),
    1 => array( 'methods' => 'POST', 'callback' => 'demo_cb' ),
    'schema' => array( 'callback' => 'demo_cb', 'methods' => 'DELETE' ),
)`);
  assert.deepEqual(route.endpoints.map((e) => [e.shape, e.methods.verbs[0], e.permission.kind]), [['list', 'GET', 'return_true'], ['list', 'POST', 'missing']]);
});

test('the third argument may be a variable: the last plain assignment before the call is read', () => {
  const code = `${HEADER}function demo_register() {
	$args = array( 'callback' => 'a' );
	$args = array( 'methods' => 'DELETE', 'callback' => 'demo_cb', 'permission_callback' => '__return_true' );
	register_rest_route( 'demo/v1', '/x', $args );
}
`;
  const [route] = resolve({ 'demo.php': code });
  assert.equal(route.endpoints.length, 1);
  assert.deepEqual(route.endpoints[0].methods.verbs, ['DELETE']);
  assert.equal(route.endpoints[0].line, 7);
});

test('a list item may be a variable holding an array', () => {
  const code = `${HEADER}function demo_register() {
	$read = array( 'methods' => 'GET', 'callback' => 'demo_cb' );
	register_rest_route( 'demo/v1', '/x', array( $read ) );
}
`;
  assert.equal(resolve({ 'demo.php': code })[0].endpoints.length, 1);
});

test('an argument that is not readable gives no endpoints and says so', () => {
  const route = one('demo_args()');
  assert.equal(route.isReadable, false);
  assert.deepEqual(route.endpoints, []);
});

test('methods: strings split on space, comma and pipe; missing means GET', () => {
  assert.deepEqual(verbs("'methods' => 'get, post'").verbs, ['GET', 'POST']);
  assert.deepEqual(verbs("'methods' => 'POST|PUT PATCH'").verbs, ['POST', 'PUT', 'PATCH']);
  const missing = verbs('');
  assert.deepEqual([missing.verbs, missing.isDefault, missing.resolved], [['GET'], true, true]);
});

test('methods: WP_REST_Server constants, with and without a leading backslash, and arrays of them', () => {
  assert.deepEqual(verbs("'methods' => WP_REST_Server::CREATABLE").verbs, ['POST']);
  assert.deepEqual(verbs("'methods' => \\WP_REST_Server::EDITABLE").verbs, ['POST', 'PUT', 'PATCH']);
  assert.deepEqual(verbs("'methods' => WP_REST_Server::ALLMETHODS").verbs, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  assert.deepEqual(verbs("'methods' => array( WP_REST_Server::READABLE, WP_REST_Server::DELETABLE )").verbs, ['GET', 'DELETE']);
  assert.deepEqual(verbs("'methods' => WP_REST_Server::READABLE . ', ' . WP_REST_Server::CREATABLE").verbs, ['GET', 'POST']);
});

test('methods: self:: and static:: class constants resolve inside the class, other values stay unresolved', () => {
  const code = (value) => `${HEADER}class Demo_Rest {
	const WRITE = WP_REST_Server::CREATABLE;
	const BOTH = 'GET, DELETE';
	public function register() {
		register_rest_route( 'demo/v1', '/x', array( 'methods' => ${value}, 'callback' => 'demo_cb' ) );
	}
}
`;
  const verbsFor = (value) => resolve({ 'demo.php': code(value) })[0].endpoints[0].methods;
  assert.deepEqual(verbsFor('self::WRITE').verbs, ['POST']);
  assert.deepEqual(verbsFor('static::BOTH').verbs, ['GET', 'DELETE']);
  assert.deepEqual(verbsFor('Demo_Rest::BOTH').verbs, ['GET', 'DELETE']);
  assert.equal(verbsFor('self::MISSING').resolved, false);
  assert.equal(verbsFor('$method').resolved, false);
});

const kindOf = (permission, rest = '') => one(`array( 'callback' => 'demo_cb', ${permission} )`, rest).endpoints[0].permission.kind;

test('permission kinds: __return_true, closures and arrow functions returning only true, other, missing', () => {
  assert.equal(kindOf("'permission_callback' => '__return_true'"), 'return_true');
  assert.equal(kindOf("'permission_callback' => '\\__return_true'"), 'return_true');
  assert.equal(kindOf("'permission_callback' => function () { return true; }"), 'closure_true');
  assert.equal(kindOf("'permission_callback' => fn() => true"), 'closure_true');
  assert.equal(kindOf("'permission_callback' => function () { return current_user_can( 'edit_posts' ); }"), 'other');
  assert.equal(kindOf("'permission_callback' => 'demo_unknown'"), 'other');
  assert.equal(kindOf(''), 'missing');
  assert.equal(kindOf("'permission_callback' => null"), 'missing');
  assert.equal(kindOf("'permission_callback' => false"), 'missing');
});

test('permission kind callable_true: a resolvable callable whose body is only return true (quests style)', () => {
  const rest = `class Demo_Rest {
	public function check_permission() {
		return true;
	}
	public function register() {
		register_rest_route( 'demo/v1', '/y', array( 'methods' => 'POST', 'callback' => array( $this, 'save' ), 'permission_callback' => array( $this, 'check_permission' ) ) );
	}
	public function save() {}
}
`;
  const [route] = resolve({ 'demo.php': `${HEADER}${rest}` });
  const { permission, callback } = route.endpoints[0];
  assert.equal(permission.kind, 'callable_true');
  assert.equal(permission.target.id, 'Demo_Rest::check_permission');
  assert.equal(callback.target.id, 'Demo_Rest::save');
  const guarded = rest.replace('return true;', "return current_user_can( 'manage_options' );");
  assert.equal(resolve({ 'demo.php': `${HEADER}${guarded}` })[0].endpoints[0].permission.kind, 'other');
});

test('callbacks: a string, a closure, __CLASS__ . "::method" and a method in another file resolve', () => {
  const code = `${HEADER}class Demo_Rest {
	public function register() {
		register_rest_route( 'demo/v1', '/a', array( 'callback' => __CLASS__ . '::remote_authorize' ) );
		register_rest_route( 'demo/v1', '/b', array( 'callback' => function () { return 1; } ) );
		$other = new Demo_Other();
		register_rest_route( 'demo/v1', '/c', array( 'callback' => array( $other, 'run' ) ) );
	}
	public static function remote_authorize() {}
}
`;
  const other = '<?php\nclass Demo_Other {\n\tpublic function run() {}\n}\n';
  const routes = resolve({ 'demo.php': code, 'includes/other.php': other });
  assert.equal(routes[0].endpoints[0].callback.target.id, 'Demo_Rest::remote_authorize');
  assert.match(routes[1].endpoints[0].callback.target.id, /#closure@/);
  assert.equal(routes[2].endpoints[0].callback.target.file, 'includes/other.php');
  const alone = resolve({ 'demo.php': code, 'includes/other.php': other }, { crossFile: false });
  assert.equal(alone[2].endpoints[0].callback.target, null);
  assert.equal(alone[0].endpoints[0].callback.target.id, 'Demo_Rest::remote_authorize');
});

test('without a project index the shape still resolves and targets are null', () => {
  const route = one("array( 'methods' => 'POST', 'callback' => 'demo_cb', 'permission_callback' => function () { return true; } )", '', { withIndex: false });
  assert.equal(route.endpoints[0].permission.kind, 'closure_true');
  assert.equal(route.endpoints[0].callback.target, null);
});
