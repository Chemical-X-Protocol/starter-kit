// Precision spec for SECURITY_WP_MISSING_NONCE (design spec 2.6). Each case is a corpus or held-out hit
// reduced to its distinct form with generic names. weight = corpus hits of that form on 2026-10-24
// (measured with the pass over the 674-file corpus: 32 handlers). label TP = the hit is a real missing
// nonce; label FP = a hit judged false and kept as a known false positive; label SILENT = a shape the
// pass must not report. Shape cases with weight 0 cover resolution paths and do not count in the figures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NONCE_SHAPES, NONCE_NAMESPACED_BAD, writePlugin, auditPlugin } from '../fixtures/php/nonce.fixtures.js';

const HEADER = '<?php\n/**\n * Plugin Name: Demo\n */\n';
const handler = (statement) => ({
  'demo.php': `${HEADER}add_action( 'wp_ajax_demo_save', 'demo_save' );\nfunction demo_save() {\n    ${statement}\n}\n`,
});

const writeForm = (name, weight, statement) => ({ name, origin: 'corpus', label: 'TP', weight, files: handler(statement) });

const CASES = [
  writeForm('update_option', 5, "update_option( 'demo_value', 'on' );"),
  writeForm('update_post_meta', 6, "update_post_meta( 1, 'demo_key', 'on' );"),
  writeForm('update_user_meta', 5, "update_user_meta( get_current_user_id(), 'demo_key', 'on' );"),
  writeForm('wp_insert_post', 2, "wp_insert_post( array( 'post_title' => 'Demo' ) );"),
  writeForm('wp_update_post', 2, "wp_update_post( array( 'ID' => 1 ) );"),
  writeForm('wp_delete_post', 2, 'wp_delete_post( 1 );'),
  writeForm('wp_insert_term', 3, "wp_insert_term( 'Demo', 'category' );"),
  writeForm('wp_mail', 1, "wp_mail( 'a@example.test', 'Demo', 'Body' );"),
  writeForm('wpdb insert', 2, "global $wpdb;\n    $wpdb->insert( $wpdb->prefix . 'demo', array( 'a' => 1 ) );"),
  writeForm('file_put_contents', 1, "file_put_contents( '/tmp/demo.txt', 'x' );"),
  writeForm('activate_plugins', 2, "activate_plugins( array( 'demo/demo.php' ) );"),
  {
    name: 'idempotent derived-value sync inside a read-only list handler',
    origin: 'corpus',
    label: 'FP',
    weight: 1,
    knownFp: 'the handler only reads; its single write recomputes a cached level, which is not a client-driven change',
    files: handler("$users = get_users();\n    foreach ( $users as $u ) {\n        demo_stats( $u->ID );\n    }\n    wp_send_json( $users );\n}\nfunction demo_stats( $id ) {\n    update_user_meta( $id, 'demo_level', 1 );"),
  },
  { name: 'write one hop away through $this', origin: 'corpus', label: 'TP', weight: 0, files: NONCE_SHAPES.methodArray },
  { name: 'write two hops away', origin: 'corpus', label: 'TP', weight: 0, files: NONCE_SHAPES.twoHopWrite },
  { name: 'loader registration, handler in another file', origin: 'corpus', label: 'TP', weight: 0, files: NONCE_SHAPES.loader },
  { name: 'hook-to-method map', origin: 'corpus', label: 'TP', weight: 0, files: NONCE_SHAPES.hookMap },
  { name: 'registration and callback in different files', origin: 'corpus', label: 'TP', weight: 0, files: NONCE_SHAPES.crossFile },
  {
    name: 'static call chain, write two calls down',
    origin: 'corpus',
    label: 'TP',
    weight: 0,
    files: { 'demo.php': `${HEADER}class Demo_Page {\n    public function boot() {\n        add_action( 'wp_ajax_demo_convert', array( $this, 'convert' ) );\n    }\n    public function convert() {\n        Demo_Bank::convert( 1 );\n    }\n}\nclass Demo_Bank {\n    public static function convert( $n ) {\n        self::record( $n );\n    }\n    private static function record( $n ) {\n        update_option( 'demo_ledger', $n );\n    }\n}\n` },
  },
  {
    name: 'dismiss handler writing a site option (snapshot-backups, wp-hummingbird)',
    origin: 'held-out H2',
    label: 'TP',
    weight: 2,
    files: handler("update_site_option( 'demo_dismissed', time() );\n    wp_send_json_success();"),
  },
  {
    name: 'capability check only, then a site-option delete (wp-hummingbird)',
    origin: 'held-out H2',
    label: 'TP',
    weight: 1,
    files: handler("if ( ! current_user_can( 'manage_options' ) ) {\n        die();\n    }\n    delete_site_option( 'demo_flag' );"),
  },
  {
    name: 'namespaced parent in another file holds the nonce check (snapshot-backups, 5 hits)',
    origin: 'held-out H2',
    label: 'SILENT',
    weight: 5,
    files: {
      'demo.php': `${HEADER}$page = new \\Demo\\Admin\\Page();\nadd_action( 'wp_ajax_demo_save', array( $page, 'save' ) );\n`,
      'includes/class-base.php': '<?php\nnamespace Demo\\Base;\nabstract class Controller {\n    protected function guard() {\n        check_ajax_referer( \'demo\' );\n    }\n}\n',
      'includes/class-page.php': '<?php\nnamespace Demo\\Admin;\nuse Demo\\Base\\Controller;\nclass Page extends Controller {\n    public function save() {\n        $this->guard();\n        update_option( \'demo_value\', \'on\' );\n    }\n}\n',
    },
  },
];

function fires(files) {
  const plugin = writePlugin(files);
  try {
    return auditPlugin(plugin.root).length > 0;
  } finally {
    plugin.cleanup();
  }
}

const results = CASES.map((c) => ({ ...c, fired: fires(c.files) }));
const precision = (origin) => {
  const fired = results.filter((r) => r.fired && r.weight > 0 && r.origin.startsWith(origin));
  const total = fired.reduce((sum, r) => sum + r.weight, 0);
  const correct = fired.filter((r) => r.label === 'TP').reduce((sum, r) => sum + r.weight, 0);
  return { correct, total, ratio: total === 0 ? 1 : correct / total };
};

test('every TP shape fires, every SILENT shape does not, the known FP is tagged and fires', () => {
  for (const r of results) {
    const expected = r.label !== 'SILENT';
    assert.equal(r.fired, expected, `${r.name}: fired=${r.fired}`);
    const needsReason = r.label === 'FP';
    assert.ok(!needsReason || r.knownFp, `${r.name} must carry a knownFp reason`);
  }
});

test('namespaced child without the parent check fires (the SILENT shape with its check removed)', () => {
  assert.equal(fires(NONCE_NAMESPACED_BAD), true);
});

test('weighted precision is at least 80% on the corpus cases and on the held-out cases', () => {
  const corpus = precision('corpus');
  const heldOut = precision('held-out');
  assert.equal(corpus.total, 32);
  assert.equal(corpus.correct, 31);
  assert.ok(corpus.ratio >= 0.8, `corpus ${corpus.correct}/${corpus.total}`);
  assert.equal(heldOut.total, 3);
  assert.ok(heldOut.ratio >= 0.8, `held-out ${heldOut.correct}/${heldOut.total}`);
});
