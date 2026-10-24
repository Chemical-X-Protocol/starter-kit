import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePhp } from './php-parse.js';
import { detectWordPress, resetWordPressCache } from './wp-detect.js';

let root;

beforeEach(() => {
  resetWordPressCache();
  root = realpathSync(mkdtempSync(join(tmpdir(), 'wp-detect-')));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function put(rel, body = '<?php\n') {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  return full;
}

const HEADER = '<?php\n/**\n * Plugin Name: Demo\n */\n';

test('plugin header at the plugin root marks nested files', () => {
  put('demo/demo.php', HEADER);
  const file = put('demo/includes/deep/a.php');
  const got = detectWordPress(file, { scanRoot: root });
  assert.deepEqual(got, { isWordPress: true, root: join(root, 'demo'), kind: 'plugin' });
});

test('scanRoot below the plugin segment root still reports the plugin', () => {
  const file = put('wp-content/plugins/foo/src/a/x.php');
  const scan = join(root, 'wp-content/plugins/foo/src');
  const got = detectWordPress(file, { scanRoot: scan });
  assert.deepEqual(got, { isWordPress: true, root: join(root, 'wp-content/plugins/foo'), kind: 'plugin' });
});

test('theme root is found through style.css', () => {
  put('theme/style.css', '/*\nTheme Name: Demo\n*/');
  const file = put('theme/inc/a.php');
  assert.equal(detectWordPress(file, { scanRoot: root }).kind, 'theme');
});

test('a plugin nested inside an app directory is detected, its sibling app is not', () => {
  put('apps/site/wordpress-plugin/main.php', HEADER);
  const inner = put('apps/site/wordpress-plugin/src/a.php');
  const other = put('apps/lawfirm/src/b.php');
  assert.equal(detectWordPress(inner, { scanRoot: root }).isWordPress, true);
  assert.deepEqual(detectWordPress(other, { scanRoot: root }), { isWordPress: false, root: null, kind: null });
});

test('relative paths resolve against scanRoot', () => {
  put('demo/demo.php', HEADER);
  put('demo/a.php');
  assert.equal(detectWordPress('demo/a.php', { scanRoot: root }).kind, 'plugin');
});

test('wp-content segment marks the plugin folder without a header', () => {
  const file = put('wp-content/plugins/bare/src/a.php');
  const got = detectWordPress(file, { scanRoot: root });
  assert.deepEqual(got, { isWordPress: true, root: join(root, 'wp-content/plugins/bare'), kind: 'plugin' });
});

test('wp-config.php counts as core only for files under its wp-content', () => {
  put('site/wp-config.php');
  const inContent = put('site/wp-content/mu-plugins-extra/a.php');
  const outside = put('site/tools/b.php');
  assert.equal(detectWordPress(inContent, { scanRoot: root }).kind, 'core');
  assert.equal(detectWordPress(outside, { scanRoot: root }).isWordPress, false);
});

test('the walk stops at scanRoot', () => {
  put('demo.php', HEADER);
  const file = put('inner/a.php');
  const scanRoot = join(root, 'inner');
  assert.equal(detectWordPress(file, { scanRoot }).isWordPress, false);
});

test('config false and true override detection', () => {
  put('demo/demo.php', HEADER);
  const wp = put('demo/a.php');
  const plain = put('plain/b.php');
  assert.equal(detectWordPress(wp, { scanRoot: root, config: { wordpress: false } }).isWordPress, false);
  const forced = detectWordPress(plain, { scanRoot: root, config: { wordpress: true } });
  assert.deepEqual(forced, { isWordPress: true, root: null, kind: null });
  assert.equal(detectWordPress(plain, { scanRoot: root, config: { wordpress: 'auto' } }).isWordPress, false);
});

test('content-only audits use AST signals; files on disk do not', () => {
  const ast = parsePhp("<?php add_action('init', 'f');").ast;
  const plainAst = parsePhp('<?php echo 1;').ast;
  const missing = join(root, 'ghost.php');
  assert.deepEqual(detectWordPress(missing, { scanRoot: root, ast }), { isWordPress: true, root: null, kind: 'signals' });
  assert.equal(detectWordPress(missing, { scanRoot: root, ast: plainAst }).isWordPress, false);
  assert.equal(detectWordPress(missing, { scanRoot: root }).isWordPress, false);
  const onDisk = put('plain/c.php');
  assert.equal(detectWordPress(onDisk, { scanRoot: root, ast }).isWordPress, false);
});

test('signals: $wpdb, ABSPATH and WP_REST_Request', () => {
  const missing = join(root, 'ghost.php');
  for (const src of ['<?php $wpdb->query(1);', '<?php echo ABSPATH;', '<?php $r = new WP_REST_Request();']) {
    const ast = parsePhp(src).ast;
    assert.equal(detectWordPress(missing, { scanRoot: root, ast }).kind, 'signals', src);
  }
});

test('a header added after a first call is seen on the next call', () => {
  const main = put('late/late.php');
  const file = put('late/a.php');
  assert.equal(detectWordPress(file, { scanRoot: root }).isWordPress, false);
  writeFileSync(main, HEADER);
  const later = new Date(Date.now() + 5000);
  utimesSync(main, later, later);
  assert.equal(detectWordPress(file, { scanRoot: root }).kind, 'plugin');
});
