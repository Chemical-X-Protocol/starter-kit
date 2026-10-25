// Precision spec for the WordPress route rules (design spec 2.4, 2.6, 8.3). Each case is a corpus or held-out hit
// reduced to its distinct form with generic names. weight = labelled hits that form stands for (the weights sum to
// the labelled count: 22 for SECURITY_WP_PUBLIC_WRITE_ROUTE, 8 for SECURITY_WP_PUBLIC_READ_SIDE_EFFECT).
// kind (write rule): 'real' = a real security hole, 'intentional' = public on purpose and should carry a chemx-allow
// reason, 'known FP' = a hit judged false that still fires. Directive precision counts real and intentional.
// label SILENT = a shape the pass must not report; those carry weight 0.
// The shapes were reduced from the card vault and Xophz plugin corpus (origin file:line) and from the held-out
// plugins named in each origin. Names are generic; no real data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEADER, auditFiles, routeFile } from '../fixtures/php/routes.fixtures.js';

const WRITE = 'SECURITY_WP_PUBLIC_WRITE_ROUTE';
const NO_PERMISSION = 'SECURITY_WP_REST_NO_PERMISSION_CALLBACK';
const READ = 'SECURITY_WP_PUBLIC_READ_SIDE_EFFECT';

const endpoint = (methods, permission = "'__return_true'", callback = "'demo_cb'") => `array(
		'methods'             => ${methods},
		'callback'            => ${callback},
		'permission_callback' => ${permission},
	)`;
const post = (body, extra = '') => ({ 'demo.php': routeFile(endpoint("'POST'"), `function demo_cb( $request ) {\n\t${body}\n}\n${extra}`) });
const get = (body, extra = '') => ({ 'demo.php': routeFile(endpoint("'GET'"), `function demo_cb( $request ) {\n\t${body}\n}\n${extra}`) });
const classFile = (registration, methods) => ({ 'demo.php': `${HEADER}class Demo_Rest {\n\tpublic function register() {\n\t\t${registration}\n\t}\n${methods}}\n` });

const real = (name, weight, origin, files) => ({ rule: WRITE, name, origin, label: 'TP', kind: 'real', weight, files });
const intentional = (name, weight, origin, files) => ({ rule: WRITE, name, origin, label: 'TP', kind: 'intentional', weight, files });

const WRITE_CASES = [
  real('anonymous vote written to post meta', 1, 'corpus class-xophz-compass-polls-api.php:22', post("update_post_meta( (int) $request['id'], 'demo_votes', 1 );")),
  real('public onboarding form saves an option', 1, 'corpus class-xophz-compass-modules-api.php:69', post("update_option( 'demo_onboarding', sanitize_text_field( $request['name'] ) );")),
  real('public checkout posts to an outside API', 1, 'corpus class-xophz-compass-modules-api.php:61', post("wp_remote_post( 'https://api.example.test/session', array( 'body' => array( 'a' => 1 ) ) );")),
  real('closure permission returning true, closure callback', 1, 'corpus class-xophz-compass.php:477', {
    'demo.php': routeFile(endpoint("'POST'", "'__return_true'", "function ( $request ) { update_option( 'demo_views', 1 ); }")),
  }),
  real('navigation tracker writes post meta', 1, 'corpus class-xophz-compass-telescope-api.php:25', post("update_post_meta( 1, 'demo_nav', 'x' );")),
  real('listen-time recorder writes user meta', 1, 'corpus class-xophz-compass-event-horizon-jukebox.php:61', post("update_user_meta( 1, 'demo_listen', 5 );")),
  real('form handler updates a table row', 1, 'corpus class-bomb-bag-forms-rest.php:13', post("global $wpdb;\n\t$wpdb->update( $wpdb->prefix . 'demo_subs', array( 'a' => 1 ), array( 'id' => 1 ) );")),
  real('DELETE route with __return_true', 1, 'corpus class-xophz-compass-xp-family-rest.php:82', {
    'demo.php': routeFile(endpoint("'DELETE'"), "function demo_cb( $request ) {\n\twp_delete_post( (int) $request['id'] );\n}\n"),
  }),
  real('WP_REST_Server::CREATABLE with a write two hops down', 1, 'corpus class-xophz-compass-xp-family-rest.php:86', {
    'demo.php': routeFile(endpoint('WP_REST_Server::CREATABLE'), "function demo_cb() {\n\tdemo_make();\n}\nfunction demo_make() {\n\tdemo_store();\n}\nfunction demo_store() {\n\tupdate_option( 'demo_code', 1 );\n}\n"),
  }),
  real('quests style: check_permission() returns true', 2, 'corpus class-xophz-compass-quests-rest.php:32', classFile(
    "register_rest_route( 'demo/v1', '/orgs', array( 'methods' => 'POST', 'callback' => array( $this, 'create_org' ), 'permission_callback' => array( $this, 'check_permission' ) ) );",
    "\tpublic function check_permission() {\n\t\treturn true;\n\t}\n\tpublic function create_org() {\n\t\twp_insert_post( array( 'post_title' => 'Demo' ) );\n\t}\n",
  )),
  intentional('forgot-password mail', 1, 'corpus class-xophz-compass-auth-api.php:51', post("wp_mail( 'a@example.test', 'Demo', 'Body' );")),
  intentional('signed webhook receiver (signature checked in a way the guard does not see)', 1, 'corpus class-xophz-compass-bugnet-cpt.php:418', post("update_post_meta( 1, 'demo_event', 'x' );")),
  intentional('payment-provider webhook inserts a row', 2, 'corpus class-xophz-compass-quests-rest.php:151', post("global $wpdb;\n\t$wpdb->insert( $wpdb->prefix . 'demo_events', array( 'a' => 1 ) );")),
  intentional('public checkout for GET and POST', 2, 'corpus class-xophz-compass-event-horizon-public.php:2403', {
    'demo.php': routeFile(endpoint("'GET, POST'"), "function demo_cb() {\n\twp_remote_post( 'https://api.example.test/pay' );\n}\n"),
  }),
  intentional('public license checkout', 1, 'corpus class-card-vault-api.php:217', post("wp_remote_post( 'https://api.example.test/license' );")),
  intentional('subscription checkout', 1, 'corpus class-xophz-compass-xp-subscriptions.php:36', post("wp_remote_post( 'https://api.example.test/subscribe' );")),
  { rule: WRITE, name: 'login handled by a session object whose check has no auth-like name', origin: 'corpus class-card-vault-api.php:233', label: 'FP', kind: 'known FP', weight: 1,
    knownFp: 'the callback checks the credential inside $this->session->resume(), whose name carries no auth word; the guard sees none',
    files: classFile("register_rest_route( 'demo/v1', '/session', array( 'methods' => 'POST', 'callback' => array( $this, 'resume' ), 'permission_callback' => '__return_true' ) );", "\tpublic function resume( $request ) {\n\t\t$this->session->resume( $request );\n\t\tupdate_option( 'demo_last', 1 );\n\t}\n") },
  { rule: WRITE, name: 'inline header comparison instead of hash_equals', origin: 'corpus class-xophz-compass-hookshot-rest.php:47', label: 'FP', kind: 'known FP', weight: 1,
    knownFp: 'the callback compares an API key with === and returns early; no auth-like call name appears',
    files: post("if ( $request->get_header( 'x-demo-key' ) !== 'k' ) {\n\t\treturn null;\n\t}\n\tupdate_option( 'demo_last', 1 );") },
  { rule: WRITE, name: 'callback rewrites an option with its own value', origin: 'corpus class-xophz-compass-phone-auth-rest.php:148', label: 'FP', kind: 'known FP', weight: 1,
    knownFp: 'the write stores the value it just read, a no-op, but the pass sees a state write',
    files: post("update_option( 'demo_seen', get_option( 'demo_seen' ) );") },
  { rule: WRITE, name: 'public bid on a showcase, throttled with a transient (card vault HEAD aa27938, the only held-out hit)', origin: 'held-out H1 includes/class-card-vault-api.php:142', label: 'TP', kind: 'intentional', weight: 1, files: post("set_transient( 'demo_bid_limit', 1, 60 );") },
];

// Write-rule corpus weights: 11 real (one case stands for 2), 8 intentional, 3 known FP: 22 labelled.
const READ_CASES = [
  { rule: READ, name: 'public verify route that also stores the session', origin: 'corpus class-xophz-compass-modules-api.php:77', label: 'TP', weight: 1, files: get("update_option( 'demo_session', 1 );") },
  { rule: READ, name: 'listing route creating a post two hops down', origin: 'corpus class-yellow-links-api.php:33', label: 'TP', weight: 1,
    files: get('demo_list();', "function demo_list() {\n\tdemo_sync();\n}\nfunction demo_sync() {\n\twp_insert_post( array( 'post_title' => 'Demo' ) );\n}\n") },
  { rule: READ, name: 'GET route writes post meta', origin: 'corpus class-xophz-compass-telescope-api.php:25', label: 'TP', weight: 1, files: get("update_post_meta( 1, 'demo_hit', 1 );") },
  { rule: READ, name: 'GET route inserts a table row', origin: 'corpus class-xophz-compass-modules-api.php:34', label: 'TP', weight: 1, files: get("global $wpdb;\n\t$wpdb->insert( $wpdb->prefix . 'demo_hits', array( 'a' => 1 ) );") },
  { rule: READ, name: 'GET route sends mail', origin: 'corpus class-xophz-compass-auth-api.php:51', label: 'TP', weight: 1, files: get("wp_mail( 'a@example.test', 'Demo', 'Body' );") },
  { rule: READ, name: 'cache fill with set_transient', origin: 'corpus class-xophz-compass-modules-api.php:34', label: 'FP', weight: 1,
    knownFp: 'a transient cache fill is not a client-visible state change', files: get("set_transient( 'demo_cache', 1, 60 );") },
  { rule: READ, name: 'fetch of a public resource', origin: 'corpus class-xophz-compass-telescope-api.php:58', label: 'FP', weight: 1,
    knownFp: 'wp_remote_get reads; the outbound-request predicate does not tell a fetch from a push', files: get("wp_remote_get( 'https://example.test/' );") },
  { rule: READ, name: 'OAuth callback storing the token', origin: 'corpus class-xophz-compass-event-horizon-patreon.php:15', label: 'FP', weight: 1,
    knownFp: 'an OAuth redirect lands on a GET route by design', files: get("update_option( 'demo_token', sanitize_text_field( $request['code'] ) );") },
];

const wpLogout = classFile("register_rest_route( 'demo/v1', '/logout', array( 'methods' => 'POST', 'callback' => array( $this, 'logout' ), 'permission_callback' => '__return_true' ) );", "\tpublic function logout() {\n\t\twp_logout();\n\t\treturn rest_ensure_response( array( 'ok' => true ) );\n\t}\n");

const SILENT_CASES = [
  { rule: WRITE, name: 'auth-like call in the callback: user id check', origin: 'corpus class-xophz-compass-push-api.php:34', files: post("if ( ! get_current_user_id() ) {\n\t\treturn null;\n\t}\n\tupdate_user_meta( get_current_user_id(), 'demo_push', 1 );") },
  { rule: WRITE, name: 'auth-like call in the callback: capability check', origin: 'corpus class-xophz-compass-push-api.php:42', files: post("if ( ! current_user_can( 'edit_posts' ) ) {\n\t\treturn null;\n\t}\n\tupdate_option( 'demo_push', 1 );") },
  { rule: WRITE, name: 'auth-like call in the callback: token validator method', origin: 'corpus class-diego-lawfirm-api.php:65', files: classFile("register_rest_route( 'demo/v1', '/up', array( 'methods' => 'POST', 'callback' => array( $this, 'upload' ), 'permission_callback' => '__return_true' ) );", "\tpublic function upload() {\n\t\t$this->validate_token();\n\t\tupdate_option( 'demo_up', 1 );\n\t}\n") },
  { rule: WRITE, name: 'card vault /auth/logout: wp_logout only', origin: 'held-out H1 includes/class-card-vault-api.php:245', files: wpLogout },
  { rule: WRITE, name: 'produce /dock: public POST, callback only reads', origin: 'held-out H1', files: post("$items = get_option( 'demo_dock', array() );\n\treturn rest_ensure_response( $items );") },
  { rule: WRITE, name: 'golden-keys /license/validate: public POST that validates without writing', origin: 'held-out H1 class-xophz-compass-golden-keys-api.php:55', files: post("$key = sanitize_text_field( $request['key'] );\n\t$known = get_option( 'demo_keys', array() );\n\treturn rest_ensure_response( array( 'valid' => in_array( $key, $known, true ) ) );") },
  { rule: NO_PERMISSION, name: 'akismet class.akismet-rest-api.php:94: array of endpoints, each with a permission_callback', origin: 'held-out H2', files: {
    'demo.php': routeFile(`array(
		array( 'methods' => 'GET', 'callback' => 'demo_cb', 'permission_callback' => 'demo_can' ),
		array( 'methods' => 'POST', 'callback' => 'demo_cb', 'permission_callback' => 'demo_can' ),
	)`, 'function demo_cb() {}\nfunction demo_can() { return current_user_can( "manage_options" ); }\n'),
  } },
  { rule: NO_PERMISSION, name: 'woocommerce webhook-deliveries v1 controller:44: top-level args, numeric endpoints, schema key', origin: 'held-out H2', files: {
    'demo.php': routeFile(`array(
		'args' => array( 'webhook_id' => array( 'type' => 'integer' ) ),
		array( 'methods' => WP_REST_Server::READABLE, 'callback' => array( $this, 'get_items' ), 'permission_callback' => array( $this, 'permissions' ), 'args' => array() ),
		'schema' => array( $this, 'get_public_item_schema' ),
	)`, ''),
  } },
  { rule: NO_PERMISSION, name: 'a schema key that itself has callback and methods is not an endpoint', origin: 'held-out H2', files: {
    'demo.php': routeFile(`array(
		array( 'methods' => 'GET', 'callback' => 'demo_cb', 'permission_callback' => '__return_true' ),
		'schema' => array( 'methods' => 'GET', 'callback' => 'demo_cb' ),
	)`, 'function demo_cb() {}\n'),
  } },
];

const fired = (c) => auditFiles(c.files).some((r) => r.rule === c.rule);
const results = [...WRITE_CASES, ...READ_CASES, ...SILENT_CASES].map((c) => ({ ...c, label: c.label || 'SILENT', weight: c.weight || 0, hit: fired(c) }));

const ratio = (cases, rule, origin, counts) => {
  const mine = cases.filter((c) => c.rule === rule && c.hit && c.weight > 0 && c.origin.startsWith(origin));
  const total = mine.reduce((sum, c) => sum + c.weight, 0);
  const correct = mine.filter(counts).reduce((sum, c) => sum + c.weight, 0);
  return { correct, total, ratio: total === 0 ? 1 : correct / total };
};

test('every TP shape fires, every SILENT shape does not, every known FP is tagged with a reason and fires', () => {
  for (const r of results) {
    const expected = r.label !== 'SILENT';
    assert.equal(r.hit, expected, `${r.name}: fired=${r.hit}`);
    assert.ok(r.label !== 'FP' || r.knownFp, `${r.name} needs a knownFp reason`);
  }
});

test('write rule, corpus: 22 labelled hits, directive precision 19/22 (86%), real holes 11/22 (50%)', () => {
  const directive = ratio(results, WRITE, 'corpus', (c) => c.label === 'TP');
  const holes = ratio(results, WRITE, 'corpus', (c) => c.kind === 'real');
  assert.deepEqual([directive.correct, directive.total], [19, 22]);
  assert.deepEqual([holes.correct, holes.total], [11, 22]);
  assert.ok(directive.ratio >= 0.8, `${directive.correct}/${directive.total}`);
});

test('write rule, held-out: every hit labelled so far is intentional-public; the bar is 80% over the hits that exist', () => {
  const heldOut = ratio(results, WRITE, 'held-out', (c) => c.label === 'TP');
  assert.deepEqual([heldOut.correct, heldOut.total], [1, 1]);
  assert.ok(heldOut.ratio >= 0.8);
});

test('read side effect: 5 TP and 3 known FP of 8 (62.5%), under the 80% bar, so it ships off', () => {
  const read = ratio(results, READ, 'corpus', (c) => c.label === 'TP');
  assert.deepEqual([read.correct, read.total], [5, 8]);
  assert.ok(read.ratio < 0.8);
});

test('the two route shapes the held-out run flagged on 89 core-controller endpoints are silent for the missing-permission rule', () => {
  const core = results.filter((r) => r.rule === NO_PERMISSION);
  assert.equal(core.length, 3);
  assert.ok(core.every((r) => r.hit === false));
});

test('jetpack style __CLASS__ . "::method" callback resolves and fires when it writes', () => {
  const files = classFile("register_rest_route( 'demo/v1', '/connect', array( 'methods' => 'POST', 'callback' => __CLASS__ . '::remote_authorize', 'permission_callback' => '__return_true' ) );", "\tpublic static function remote_authorize() {\n\t\tupdate_option( 'demo_link', 1 );\n\t}\n");
  assert.deepEqual(auditFiles(files).map((r) => r.rule), [WRITE]);
});
