// Precision spec for SECURITY_WP_UNSANITIZED_INPUT, SECURITY_WP_SSRF and SECURITY_WP_OPEN_REDIRECT
// (design spec 2.6, 8.3). Each case reduces one labelled hit to its distinct form with generic names.
// weight = labelled hits the case stands for (the corpus run of 2026-10-24: 8 URL-sink hits, 9 input hits).
// label TP must fire `rule`; label FP must stay silent unless `known: 'FP'` (a documented false positive
// that still fires). origin 'corpus' is the 674-file plugin corpus; 'held-out' is code the pass was not
// tuned on. Weight 0 cases cover shapes and do not count in the figures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writePlugin, auditRequestFlowPlugin } from '../fixtures/php/request-flow.fixtures.js';
import { RULE_DEFAULTS } from './wp-request-flow.js';

const INPUT = 'SECURITY_WP_UNSANITIZED_INPUT';
const SSRF = 'SECURITY_WP_SSRF';
const REDIRECT = 'SECURITY_WP_OPEN_REDIRECT';
const HEADER = '<?php\n/**\n * Plugin Name: Demo\n */\n';
const single = (body) => ({ 'demo.php': `${HEADER}function demo( $request, $param ) {\n${body}\n}\n` });
const klass = (body) => ({ 'demo.php': `${HEADER}class Demo_Api {\n${body}\n}\n` });

const CASES = [
  // ---- SSRF and redirect, corpus (8 labelled hits, all true) ----
  { rule: SSRF, label: 'TP', origin: 'corpus', ref: 'xophz-compass/includes/class-xophz-compass-telescope-api.php:199,203', weight: 2,
    files: single(`$url = $request->get_param( 'url' );\nif ( empty( $url ) ) { return new WP_Error( 'invalid_url', 'x' ); }\n$response = wp_remote_head( $url, array( 'timeout' => 5 ) );\nif ( is_wp_error( $response ) ) { $response = wp_remote_get( $url ); }`) },
  { rule: REDIRECT, label: 'TP', origin: 'corpus', ref: 'xophz-compass-bomb-bag/includes/class-bomb-bag-rest.php:294', weight: 1,
    files: single(`$url = urldecode( $request->get_param( 'url' ) ?? '' );\nif ( $url && filter_var( $url, FILTER_VALIDATE_URL ) ) { wp_redirect( $url ); exit; }`) },
  { rule: REDIRECT, label: 'TP', origin: 'corpus', ref: 'xophz-compass-card-vault/includes/class-card-vault-catalog-rest.php:657 (fallback_url redirect)', weight: 1,
    files: single(`$fallback_url = ! empty( $request->get_param( 'fallback_url' ) ) ? esc_url_raw( (string) $request->get_param( 'fallback_url' ) ) : '';\nif ( $fallback_url ) { wp_redirect( $fallback_url ); exit; }`) },
  { rule: SSRF, label: 'TP', origin: 'corpus', ref: 'xophz-compass-moving-castle/includes/api-traits/trait-moving-castle-api-import.php:114', weight: 1,
    files: single(`$params = $request->get_json_params();\n$base_url = esc_url_raw( $params['base_url'] );\n$data_url = $base_url . '/wp-json/demo/v1/data?table=' . rawurlencode( $param );\n$response = wp_remote_get( $data_url, array( 'timeout' => 60 ) );`) },
  { rule: SSRF, label: 'TP', origin: 'corpus', ref: 'xophz-compass-card-vault/includes/class-card-vault-catalog-rest.php:773 (two-file image-cache fetch)', weight: 1,
    files: {
      'demo.php': `${HEADER}function demo_sync( $request ) {\n\treturn Demo_Importer::sync_from_hub( $request->get_param( 'snapshot_url' ) );\n}\n`,
      'includes/class-demo-importer.php': `<?php\nclass Demo_Importer {\n\tpublic static function sync_from_hub( $snapshot_url ) {\n\t\treturn wp_remote_get( $snapshot_url, array( 'timeout' => 30 ) );\n\t}\n}\n`,
    } },
  { rule: SSRF, label: 'TP', origin: 'corpus', ref: 'xophz-compass-moving-castle/.../trait-moving-castle-api-import.php:266 (two sinks in pull_files)', weight: 2,
    files: klass(`\tpublic function process( $request ) {\n\t\t$params = $request->get_json_params();\n\t\t$base_url = esc_url_raw( $params['base_url'] );\n\t\treturn $this->pull_files( $base_url );\n\t}\n\tprivate function pull_files( $base_url ) {\n\t\twp_remote_get( $base_url . '/a' );\n\t\twp_remote_get( $base_url . '/b' );\n\t}`) },

  // ---- unsanitized input, corpus (9 labelled hits: 8 true, 1 false) ----
  { rule: INPUT, label: 'TP', origin: 'corpus', ref: 'xophz-compass/admin/class-xophz-compass-admin.php:207,208', weight: 2,
    files: single(`add_action( 'admin_head', function () {\n\t$host = isset( $_SERVER['HTTP_HOST'] ) ? explode( ':', $_SERVER['HTTP_HOST'] )[0] : 'localhost';\n\t$url = 'http://' . $host . ':8080';\n\techo '<script src="' . $url . '/client"></script>';\n\techo '<script src="' . $url . '/app.ts"></script>';\n} );`) },
  { rule: INPUT, label: 'TP', origin: 'corpus', ref: 'xophz-compass-bazaar/admin/class-xophz-compass-bazaar-admin-sales.php:295,298', weight: 2,
    files: single(`$args = $_REQUEST;\nheader( "Content-Disposition: attachment; filename={$args['filename']}" );\nheader( "Content-Name: {$args['filename']}" );`) },
  { rule: INPUT, label: 'TP', origin: 'corpus', ref: 'xophz-compass-bazaar/admin/class-xophz-compass-bazaar-admin-sales.php:305', weight: 1,
    files: single(`global $wpdb;\n$args = $_REQUEST;\n$sql = Demo_Sales::report_sql( $args );\n$results = $wpdb->get_results( $sql );`) },
  { rule: INPUT, label: 'TP', origin: 'corpus', ref: 'xophz-compass-enchiridion/admin/class-xophz-compass-enchiridion-admin.php:165,169', weight: 2,
    files: single(`$input = Demo::get_input_json();\nif ( null === $input || ! is_object( $input ) ) { $input = (object) $_POST; }\nif ( isset( $input->css ) ) { update_option( 'demo_css', wp_unslash( $input->css ) ); }\nif ( isset( $input->js ) ) { update_option( 'demo_js', wp_unslash( $input->js ) ); }`) },
  { rule: INPUT, label: 'TP', origin: 'corpus', ref: 'xophz-compass-xp/admin/class-xophz-compass-xp-goals.php:282', weight: 1,
    files: single(`if ( isset( $_POST['cfg'] ) ) {\n\t$json = wp_unslash( $_POST['cfg'] );\n\t$decoded = json_decode( $json, true );\n\tif ( json_last_error() === JSON_ERROR_NONE ) { update_post_meta( $param, '_cfg', $json ); }\n}`) },
  { rule: INPUT, label: 'FP', known: 'FP', origin: 'corpus', ref: 'xophz-compass-diego-lawfirm/public/class-xophz-compass-diego-lawfirm-public.php:787 (dev-server HTML rewritten with the request host, echoed)', weight: 1,
    files: single(`$host = explode( ':', $_SERVER['HTTP_HOST'] )[0];\n$dist = '//' . $host . ':8090/';\n$html = wp_remote_retrieve_body( $param );\n$html = preg_replace( '/(src)=["\\']js\\//i', '$1="' . $dist, $html );\necho $html;`) },

  // ---- held-out false positives that must stay silent (review of 2026-10-24, card vault HEAD and H2) ----
  { rule: INPUT, label: 'FP', origin: 'held-out', ref: 'constellations-api.php:150 (value bound by prepare)', weight: 1,
    files: single(`global $wpdb;\n$sql = $wpdb->prepare( 'SELECT * FROM t WHERE id = %d AND k = %s', absint( $_GET['id'] ), $_GET['k'] );\n$rows = $wpdb->get_results( $sql );`) },
  { rule: INPUT, label: 'FP', origin: 'held-out', ref: 'quests-rest.php:1819 (request value is the meta object id)', weight: 1,
    files: single(`update_post_meta( $_POST['quest_id'], '_status', 'done' );`) },
  { rule: INPUT, label: 'FP', origin: 'held-out', ref: 'bomb-bag-rest.php:1145 (absint-then-implode)', weight: 1,
    files: single(`global $wpdb;\n$ids = array_filter( array_map( 'absint', (array) $_POST['ids'] ) );\n$wpdb->query( 'DELETE FROM t WHERE id IN (' . implode( ',', $ids ) . ')' );`) },
  { rule: INPUT, label: 'FP', origin: 'held-out', ref: 'card vault api.php:1777 (wp_create_user result ->ID)', weight: 1,
    files: single(`$user = wp_create_user( sanitize_user( $_POST['u'] ), $_POST['p'] );\nupdate_user_meta( $user->ID, 'demo_key', 'on' );\nheader( 'X-Demo-User: ' . $user->ID );`) },

  // ---- held-out false positives found by running the pass over the corpus on 2026-10-24 ----
  { rule: REDIRECT, label: 'FP', origin: 'held-out', ref: 'card-vault-catalog-rest.php:661,683,696 (url read from a catalog lookup keyed by a sanitized request id)', weight: 1,
    files: single(`$id = sanitize_text_field( (string) $request->get_param( 'id' ) );\n$card = Demo_Catalog::get_card( $id );\n$cached = Demo_Cache::cached_url( $id );\nwp_redirect( $cached, 302 );\n$fallback = ! empty( $card['image_url'] ) ? esc_url_raw( (string) $card['image_url'] ) : '';\nwp_redirect( $fallback, 302 );`) },
  { rule: SSRF, label: 'FP', origin: 'held-out', ref: 'card-vault-catalog-rest.php:620 (uploaded CSV temp path passed to an importer that opens it)', weight: 1,
    files: {
      'demo.php': `${HEADER}function demo_upload( $request ) {\n\t$files = $request->get_file_params();\n\t$tmp_file = $files['file']['tmp_name'];\n\treturn Demo_Importer::ingest( $tmp_file );\n}\n`,
      'includes/class-demo-importer.php': `<?php\nclass Demo_Importer {\n\tpublic static function ingest( $path ) {\n\t\treturn fopen( $path, 'r' );\n\t}\n}\n`,
    } },
  { rule: SSRF, label: 'FP', origin: 'held-out', ref: 'event-horizon public.php:2599 (local file path built by a helper from sanitized request values)', weight: 1,
    files: klass(`\tpublic function icon( $request ) {\n\t\t$icon = sanitize_text_field( $request->get_param( 'icon' ) );\n\t\t$file_path = $this->locate_icon( $icon );\n\t\treturn file_get_contents( $file_path );\n\t}`) },
  { rule: INPUT, label: 'FP', origin: 'held-out', ref: 'event-horizon public.php:297 (payload encoded with wp_json_encode and the JSON_HEX flags)', weight: 1,
    files: single(`$payload = array( 'status' => $_GET['status'] );\necho 'const payload = ' . wp_json_encode( $payload, JSON_HEX_TAG | JSON_HEX_AMP ) . ';';\n$json = wp_json_encode( $payload );\necho $json;`) },

  // ---- shapes (weight 0) ----
  { rule: SSRF, label: 'TP', origin: 'shape', ref: 'moving-castle import.php:36 (host taken from parse_url of a request value)', weight: 0,
    files: single(`$parsed = wp_parse_url( $request->get_param( 'connection_url' ) );\n$base_url = $parsed['scheme'] . '://' . $parsed['host'];\nwp_remote_get( $base_url . '/wp-json/demo/v1/schema' );`) },
  { rule: SSRF, label: 'TP', origin: 'shape', ref: 'esc_url_raw passes taint', weight: 0, files: single(`wp_remote_get( esc_url_raw( $_GET['u'] ) );`) },
  { rule: SSRF, label: 'FP', origin: 'shape', ref: 'wp_http_validate_url kills the flow', weight: 0, files: single(`$u = $_GET['u'];\nif ( ! wp_http_validate_url( $u ) ) { return; }\nwp_remote_get( $u );`) },
  { rule: REDIRECT, label: 'FP', origin: 'shape', ref: 'wp_validate_redirect kills the flow', weight: 0, files: single(`wp_redirect( wp_validate_redirect( $_GET['to'], home_url() ) );`) },
  { rule: SSRF, label: 'FP', origin: 'shape', ref: 'uploaded temp file is a path, not a URL', weight: 0, files: single(`$files = $request->get_file_params();\n$data = file_get_contents( $files['f']['tmp_name'] );`) },
];

function firedRules(files) {
  const plugin = writePlugin(files);
  try {
    return auditRequestFlowPlugin(plugin.root).map((record) => record.rule);
  } finally {
    plugin.cleanup();
  }
}

const results = CASES.map((item) => ({ item, fired: firedRules(item.files).includes(item.rule) }));
const sum = (list) => list.reduce((total, { item }) => total + item.weight, 0);

function precision(rule, origin) {
  const own = results.filter(({ item, fired }) => item.rule === rule && item.origin === origin && fired);
  const truePositive = sum(own.filter(({ item }) => item.label === 'TP'));
  const reported = sum(own);
  return reported === 0 ? 1 : truePositive / reported;
}

test('every TP fires, every FP stays silent, known FPs still fire', () => {
  for (const { item, fired } of results) {
    const expected = item.label === 'TP' || item.known === 'FP';
    assert.equal(fired, expected, `${item.label} ${item.rule} ${item.ref}`);
  }
});

test('corpus weights: 8 URL-sink hits, 8 input true positives and 1 known false positive', () => {
  const corpus = results.filter(({ item }) => item.origin === 'corpus');
  const tp = (rules) => sum(corpus.filter(({ item }) => rules.includes(item.rule) && item.label === 'TP'));
  assert.equal(tp([SSRF, REDIRECT]), 8);
  assert.equal(tp([INPUT]), 8);
  assert.equal(sum(corpus.filter(({ item }) => item.known === 'FP')), 1);
});

test('held-out false positives are all silent (8 labelled)', () => {
  const heldOut = results.filter(({ item }) => item.origin === 'held-out');
  assert.equal(sum(heldOut), 8);
  assert.deepEqual(heldOut.filter(({ fired }) => fired), []);
});

test('the three default-on ids reach 80% weighted precision on corpus and held-out labels', () => {
  for (const rule of [INPUT, SSRF, REDIRECT]) {
    assert.equal(RULE_DEFAULTS[rule].defaultOn, true, rule);
    assert.ok(precision(rule, 'corpus') >= 0.8, `${rule} corpus`);
    assert.ok(precision(rule, 'held-out') >= 0.8, `${rule} held-out`);
  }
});
