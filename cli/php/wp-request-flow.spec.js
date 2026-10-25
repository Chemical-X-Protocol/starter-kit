import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { REQUEST_FLOW_FIXTURES, REQUEST_FLOW_PLUGINS, writePlugin, auditRequestFlowPlugin } from '../fixtures/php/request-flow.fixtures.js';
import { wpRequestFlowPass, wpRequestFlowRegistration, RULE_DEFAULTS } from './wp-request-flow.js';
import { runDangerousPass } from './php-dangerous.js';

const WP = { isWordPress: true, root: null, kind: 'plugin' };
const wrap = (body) => `<?php\nfunction demo( $request, $param ) {\n${body}\n}\n`;

function run(code, options = {}) {
  const ctx = buildPassContext(code, { wp: WP, ...options });
  wpRequestFlowPass(ctx);
  return ctx.records;
}

const rulesOf = (body) => run(wrap(body)).map((record) => record.rule);

function audit(files, options) {
  const plugin = writePlugin(files);
  try {
    return auditRequestFlowPlugin(plugin.root, options);
  } finally {
    plugin.cleanup();
  }
}

test('fixture pairs: the bad source fires its rule, the good source is silent', () => {
  const flowPairs = Object.entries(REQUEST_FLOW_FIXTURES).filter(([rule]) => rule !== 'SECURITY_WP_UNESCAPED_OUTPUT');
  for (const [rule, fixture] of flowPairs) {
    const options = { path: fixture.path, config: fixture.config };
    assert.deepEqual(run(fixture.bad, options).map((r) => r.rule), [rule], `${rule} bad`);
    assert.deepEqual(run(fixture.good, options), [], `${rule} good`);
  }
});

test('good fixtures are also clean under the dangerous-function pass', () => {
  for (const fixture of Object.values(REQUEST_FLOW_FIXTURES)) {
    const ctx = buildPassContext(fixture.good, { path: fixture.path, config: fixture.config, wp: WP });
    runDangerousPass(ctx);
    assert.deepEqual(ctx.records, []);
  }
});

test('the pass is silent outside WordPress and the registration names the three ids', () => {
  const ctx = buildPassContext(wrap(`update_option( 'k', $_POST['v'] );`));
  wpRequestFlowPass(ctx);
  assert.deepEqual(ctx.records, []);
  assert.deepEqual(wpRequestFlowRegistration.rules, ['SECURITY_WP_UNSANITIZED_INPUT', 'SECURITY_WP_SSRF', 'SECURITY_WP_OPEN_REDIRECT']);
  assert.equal(wpRequestFlowRegistration.isWordPress, true);
  assert.deepEqual(Object.keys(RULE_DEFAULTS).sort(), [...wpRequestFlowRegistration.rules].sort());
});

test('unsanitized input: each sink fires for a superglobal value', () => {
  const rule = 'SECURITY_WP_UNSANITIZED_INPUT';
  const sinks = [
    `echo $_GET['x'];`,
    `print $_GET['x'];`,
    `update_option( 'k', $_POST['x'] );`,
    `add_option( 'k', $_POST['x'] );`,
    `update_post_meta( 1, 'k', $_POST['x'] );`,
    `update_user_meta( 1, 'k', $_REQUEST['x'] );`,
    `wp_insert_post( array( 'post_content' => $_POST['c'] ) );`,
    `wp_update_post( array( 'ID' => 1, 'post_content' => $_POST['c'] ) );`,
    `header( 'X-Demo: ' . $_GET['x'] );`,
    `setcookie( 'k', $_COOKIE['x'] );`,
    `file_put_contents( '/tmp/demo.txt', $_POST['x'] );`,
    `unserialize( $_POST['x'] );`,
    `extract( $_POST );`,
    `call_user_func( $_GET['cb'] );`,
    `include $_GET['page'];`,
    `global $wpdb; $wpdb->query( "DELETE FROM t WHERE a = '" . $_GET['a'] . "'" );`,
    `$this->wpdb->get_results( "SELECT * FROM t WHERE a = " . $_GET['a'] );`,
    `$v = $_SERVER['HTTP_HOST']; echo $v;`,
  ];
  for (const sink of sinks) assert.ok(rulesOf(sink).includes(rule), sink);
});

test('unsanitized input: sanitizers, casts, object ids, bound values and tainted-then-cleaned flows stay silent', () => {
  const silent = [
    `update_option( 'k', sanitize_text_field( wp_unslash( $_POST['x'] ) ) );`,
    `update_option( 'k', absint( $_POST['x'] ) );`,
    `update_option( 'k', (int) $_POST['x'] );`,
    `update_post_meta( $_POST['id'], 'k', 'fixed' );`,
    `update_post_meta( absint( $_POST['id'] ), 'k', 'fixed' );`,
    `echo esc_html( $_GET['x'] );`,
    `wp_update_post( array( 'ID' => $_POST['id'], 'post_status' => 'draft' ) );`,
    `global $wpdb; $wpdb->insert( 't', array( 'a' => $_POST['a'] ) );`,
    `global $wpdb; $sql = $wpdb->prepare( 'SELECT * FROM t WHERE a = %s', $_GET['a'] ); $wpdb->get_results( $sql );`,
    `global $wpdb; $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM t WHERE a = %s', $_GET['a'] ) );`,
    `$ids = array_map( 'absint', explode( ',', $_POST['ids'] ) ); global $wpdb; $wpdb->query( 'DELETE FROM t WHERE id IN (' . implode( ',', $ids ) . ')' );`,
    `$user = wp_insert_user( array( 'user_login' => $_POST['u'] ) ); update_user_meta( $user->ID, 'k', 'v' );`,
    `$v = $_GET['x']; $v = sanitize_key( $v ); update_option( 'k', $v );`,
    `$r = wp_remote_get( 'https://example.test/' ); $body = wp_remote_retrieve_body( $r ); update_option( 'k', $body );`,
    `update_option( 'k', $request->get_param( 'x' ) );`,
    `if ( isset( $_GET['x'] ) ) { update_option( 'k', 1 ); }`,
  ];
  for (const body of silent) assert.deepEqual(rulesOf(body), [], body);
});

test('unsanitized input: the last plain assignment decides', () => {
  assert.deepEqual(rulesOf(`$v = $_POST['x']; $v = 'fixed'; update_option( 'k', $v );`), []);
  assert.deepEqual(rulesOf(`$v = 'fixed'; $v = $_POST['x']; update_option( 'k', $v );`), ['SECURITY_WP_UNSANITIZED_INPUT']);
});

test('SSRF: URL sinks fire when a request value chooses the host', () => {
  const rule = 'SECURITY_WP_SSRF';
  const sinks = ['wp_remote_get', 'wp_remote_post', 'wp_remote_request', 'wp_remote_head', 'download_url', 'file_get_contents', 'fopen', 'curl_init', 'media_sideload_image', 'getimagesize'];
  for (const sink of sinks) assert.deepEqual(rulesOf(`${sink}( $request->get_param( 'url' ) );`), [rule], sink);
  assert.deepEqual(rulesOf(`$params = $request->get_json_params(); $base = esc_url_raw( $params['base_url'] ); wp_remote_get( $base . '/wp-json/x' );`), [rule]);
  assert.deepEqual(rulesOf(`$u = $_GET['u']; if ( $param ) { $u = 'https://fixed.test/'; } wp_remote_get( $u );`), [rule]);
});

test('SSRF: a validated URL still fires for wp_remote_* that follow redirects', () => {
  const rule = ['SECURITY_WP_SSRF'];
  const guard = `$u = $_GET['u']; if ( ! wp_http_validate_url( $u ) ) { return; } `;
  assert.deepEqual(rulesOf(`${guard}wp_remote_get( $u );`), rule);
  assert.deepEqual(rulesOf(`${guard}wp_remote_get( $u, array( 'redirection' => 5 ) );`), rule);
  assert.deepEqual(rulesOf(`${guard}wp_remote_post( $u, array( 'timeout' => 5 ) );`), rule);
  assert.deepEqual(rulesOf(`${guard}wp_remote_get( $u, array( 'reject_unsafe_urls' => false ) );`), rule);
  assert.deepEqual(rulesOf(`${guard}wp_safe_remote_get( $u );`), []);
});

test('SSRF and redirect: esc_url_raw passes taint; validators, safe bases, safe sinks and path-only values do not', () => {
  assert.deepEqual(rulesOf(`wp_remote_get( esc_url_raw( $_GET['u'] ) );`), ['SECURITY_WP_SSRF']);
  assert.deepEqual(rulesOf(`wp_remote_get( wp_http_validate_url( $_GET['u'] ) );`), []);
  assert.deepEqual(rulesOf(`$u = $_GET['u']; if ( ! wp_http_validate_url( $u ) ) { return; } wp_remote_get( $u, array( 'redirection' => 0 ) );`), []);
  assert.deepEqual(rulesOf(`$u = $_GET['u']; if ( ! wp_http_validate_url( $u ) ) { return; } wp_remote_get( $u, array( 'reject_unsafe_urls' => true ) );`), []);
  assert.deepEqual(rulesOf(`$u = $_GET['u']; if ( ! wp_http_validate_url( $u ) ) { return; } file_get_contents( $u );`), []);
  assert.deepEqual(rulesOf(`wp_redirect( wp_validate_redirect( $_GET['to'], home_url() ) );`), []);
  assert.deepEqual(rulesOf(`wp_safe_redirect( $_GET['to'] );`), []);
  assert.deepEqual(rulesOf(`wp_safe_remote_get( $_GET['u'] );`), []);
  assert.deepEqual(rulesOf(`wp_remote_get( home_url( '/x' ) . $_GET['p'] );`), []);
  assert.deepEqual(rulesOf(`wp_remote_get( 'https://api.example.test/v1/' . $_GET['p'] );`), []);
  assert.deepEqual(rulesOf(`wp_redirect( add_query_arg( 'k', $_GET['v'], admin_url( 'x.php' ) ) );`), []);
  assert.deepEqual(rulesOf(`wp_redirect( $_GET['to'] );`), ['SECURITY_WP_OPEN_REDIRECT']);
});

test('uploaded temp files are not URLs', () => {
  assert.deepEqual(rulesOf(`$files = $request->get_file_params(); file_get_contents( $files['f']['tmp_name'] );`), []);
  assert.deepEqual(rulesOf(`$tmp = $_FILES['f']['tmp_name']; $d = file_get_contents( $tmp ); getimagesize( $tmp );`), []);
  assert.deepEqual(rulesOf(`file_get_contents( $request->get_param( 'u' ) );`), ['SECURITY_WP_SSRF']);
});

test('one hop across files: the finding sits at the call site and names the sink', () => {
  const hits = audit(REQUEST_FLOW_PLUGINS.imageCache);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, 'SECURITY_WP_SSRF');
  assert.equal(hits[0].file, 'demo.php');
  assert.equal(hits[0].line, 6);
  assert.equal(hits[0].crossFile, true);
  assert.match(hits[0].evidence, /includes\/class-demo-cache\.php:4 wp_remote_get\(\)/);
  assert.match(hits[0].hazard, /wp_remote_get\(\)/);
});

test('one hop in the same file is not crossFile; a redirect helper gives OPEN_REDIRECT', () => {
  const method = audit(REQUEST_FLOW_PLUGINS.sameFileMethod);
  assert.deepEqual(method.map((h) => [h.rule, h.crossFile, h.line]), [['SECURITY_WP_SSRF', false, 7]]);
  const redirect = audit(REQUEST_FLOW_PLUGINS.redirectHelper);
  assert.deepEqual(redirect.map((h) => [h.rule, h.crossFile]), [['SECURITY_WP_OPEN_REDIRECT', false]]);
});

test('one hop stays silent for a path-only callee and for a callee that validates', () => {
  assert.deepEqual(audit(REQUEST_FLOW_PLUGINS.pathOnly), []);
  assert.deepEqual(audit(REQUEST_FLOW_PLUGINS.validatedCalleeNoRedirect), []);
});

test('one hop still fires when the callee validates but follows redirects', () => {
  const hits = audit(REQUEST_FLOW_PLUGINS.validatedCallee);
  assert.deepEqual(hits.map((h) => h.rule), ['SECURITY_WP_SSRF']);
});

test('crossFile false drops the cross-file hop but keeps the same-file one', () => {
  assert.deepEqual(audit(REQUEST_FLOW_PLUGINS.imageCache, { crossFile: false }), []);
  assert.equal(audit(REQUEST_FLOW_PLUGINS.sameFileMethod, { crossFile: false }).length, 1);
});

test('the callee file alone reports nothing: its parameter is not a request value there', () => {
  const hits = audit(REQUEST_FLOW_PLUGINS.imageCache).filter((h) => h.file !== 'demo.php');
  assert.deepEqual(hits, []);
});

test('findings are anchored on the sink line', () => {
  const [hit] = run(`<?php\n\nfunction demo( $r ) {\n\nwp_redirect( $_GET['t'] );\n}\n`);
  assert.equal(hit.line, 5);
});
