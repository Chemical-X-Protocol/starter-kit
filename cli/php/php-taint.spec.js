import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhp } from './php-parse.js';
import { linkParents, walk, scopeOf, callName } from './php-walk.js';
import { createScopeIndex, isRequestDerived, hostTaint } from './php-taint.js';

// Parses `body` inside a function and returns the first argument of the last sink() call plus the scope index.
function probe(body) {
  const ast = parsePhp(`<?php function demo($param) {\n${body}\n}`).ast;
  linkParents(ast);
  let sink = null;
  walk(ast, (node) => {
    const info = node.kind === 'call' ? callName(node) : null;
    const isSink = Boolean(info) && info.name === 'sink';
    if (isSink) sink = node;
  });
  assert.ok(sink, 'fixture needs a sink() call');
  return { expr: sink.arguments[0], idx: createScopeIndex(scopeOf(sink)) };
}

function derived(body, opts) {
  const { expr, idx } = probe(body);
  return isRequestDerived(expr, idx, opts);
}

function host(body, opts) {
  const { expr, idx } = probe(body);
  return hostTaint(expr, idx, opts);
}

test('superglobal sources', () => {
  assert.equal(derived(`sink($_GET['a']);`), true);
  assert.equal(derived(`sink($_POST['a']['b']);`), true);
  assert.equal(derived(`sink($_REQUEST['a']);`), true);
  assert.equal(derived(`sink($_COOKIE['a']);`), true);
  assert.equal(derived(`sink($_SERVER['HTTP_X_FORWARDED_FOR']);`), true);
  assert.equal(derived(`sink($_SERVER['REQUEST_URI']);`), true);
  assert.equal(derived(`sink($_SERVER['QUERY_STRING']);`), true);
  assert.equal(derived(`sink($_SERVER['PHP_SELF']);`), true);
  assert.equal(derived(`sink($_GET);`), true);
});

test('non-sources stay clean', () => {
  assert.equal(derived(`sink($_SERVER['REMOTE_ADDR']);`), false);
  assert.equal(derived(`sink($_SERVER);`), false);
  assert.equal(derived(`sink($_FILES['f']['tmp_name']);`), false);
  assert.equal(derived(`sink($param);`), false);
  assert.equal(derived(`sink('literal');`), false);
  assert.equal(derived(`sink(get_option('demo'));`), false);
});

test('request object sources, selectable apart from superglobals', () => {
  const requestForms = [
    `sink($request['a']);`,
    `sink($request->get_param('a'));`,
    `sink($request->get_params());`,
    `sink($request->get_json_params());`,
    `sink($request->get_body_params());`,
    `sink($request->get_query_params());`,
    `sink($request->get_file_params());`,
    `sink($request->get_header('x'));`,
    `sink($request->get_body());`,
    `sink(get_query_var('a'));`,
    `sink(filter_input(INPUT_GET, 'a'));`,
    `sink(file_get_contents('php://input'));`,
  ];
  for (const code of requestForms) {
    assert.equal(derived(code), true, code);
    assert.equal(derived(code, { sources: ['request'] }), true, code);
    assert.equal(derived(code, { sources: ['superglobal'] }), false, code);
  }
  assert.equal(derived(`sink($_GET['a']);`, { sources: ['request'] }), false);
  assert.equal(derived(`sink(file_get_contents('/etc/hosts'));`), false);
});

test('propagation through assignment, concat, interpolation, arrays and string casts', () => {
  assert.equal(derived(`$a = $_GET['a']; $b = $a; sink($b);`), true);
  assert.equal(derived(`$a = 'x' . $_GET['a']; sink($a);`), true);
  assert.equal(derived(`$a = "pre {$_GET['a']}"; sink($a);`), true);
  assert.equal(derived(`$a = (string) $_GET['a']; sink($a);`), true);
  assert.equal(derived(`$a = array('k' => $_GET['a']); sink($a);`), true);
  assert.equal(derived(`$a = wp_unslash($_POST['a']); sink($a);`), true);
  assert.equal(derived(`$a = ''; $a .= $_GET['a']; sink($a);`), true);
  assert.equal(derived(`$a = []; $a[] = $_GET['a']; sink($a);`), true);
  assert.equal(derived(`$a = []; $a['k'] = $_GET['a']; sink($a);`), true);
  assert.equal(derived(`foreach ($_POST['ids'] as $id) { sink($id); }`), true);
  assert.equal(derived(`foreach ($_POST as $k => $v) { sink($k); }`), true);
  assert.equal(derived(`[$a, $b] = $_GET['pair']; sink($b);`), true);
  assert.equal(derived(`list($a) = $_GET['pair']; sink($a);`), true);
  assert.equal(derived(`preg_match('/x/', $_GET['a'], $m); sink($m);`), true);
  assert.equal(derived(`parse_str($_SERVER['QUERY_STRING'], $q); sink($q);`), true);
  assert.equal(derived(`$a = $_GET['a'] ?? ''; sink($a);`), true);
  assert.equal(derived(`$a = isset($_GET['a']) ? $_GET['a'] : ''; sink($a);`), true);
});

test('sanitizers and numeric casts stop taint', () => {
  assert.equal(derived(`sink(absint($_GET['a']));`), false);
  assert.equal(derived(`sink((int) $_GET['a']);`), false);
  assert.equal(derived(`sink(sanitize_text_field(wp_unslash($_POST['a'])));`), false);
  assert.equal(derived(`sink(esc_html($_GET['a']));`), false);
  assert.equal(derived(`sink(intval($_GET['a']));`), false);
  assert.equal(derived(`sink(isset($_GET['a']));`), false);
  assert.equal(derived(`sink($_GET['a'] === 'x');`), false);
  assert.equal(derived(`$a = sanitize_key($_GET['a']); $b = $a . 'x'; sink($b);`), false);
  assert.equal(derived(`sink(sanitize_text_field($request->get_param('a')));`), false);
});

test('union keeps every branch, last keeps only the last assignment', () => {
  const branches = `$a = 'safe'; if ($param) { $a = $_GET['a']; } sink($a);`;
  assert.equal(derived(branches), true);
  assert.equal(derived(branches, { mode: 'union' }), true);
  assert.equal(derived(branches, { mode: 'last' }), true);
  const overwritten = `$a = $_GET['a']; if ($param) { $a = 'safe'; } sink($a);`;
  assert.equal(derived(overwritten, { mode: 'union' }), true);
  assert.equal(derived(overwritten, { mode: 'last' }), false);
});

test('flow sensitivity: an unconditional reassignment kills earlier taint', () => {
  assert.equal(derived(`$a = $_GET['a']; $a = 'safe'; sink($a);`), false);
  assert.equal(derived(`$a = $_GET['a']; $a = absint($a); sink($a);`), false);
  assert.equal(derived(`$a = 'safe'; sink($a); $a = $_GET['a'];`), false);
  assert.equal(derived(`$a = $_GET['a']; $b = $a; $a = 'safe'; sink($b);`), true);
  assert.equal(derived(`$a = $_GET['a']; $b = $a; $b = 'safe'; sink($b . $a);`), true);
  assert.equal(derived(`$a = $_GET['a']; $a .= 'x'; sink($a);`), true);
});

test('stored sanitizer shapes stay clean at every hop (absint, implode)', () => {
  const body = `$ids = array_map('absint', explode(',', $_GET['ids'])); $list = implode(',', $ids); $sql = "WHERE id IN ($list)"; sink($sql);`;
  assert.equal(derived(body), false);
  assert.equal(derived(`$ids = explode(',', $_GET['ids']); $list = implode(',', $ids); sink($list);`), true);
});

test('taint stops at prepare, wpdb reads, remote responses and id-returning WP APIs', () => {
  assert.equal(derived(`sink($wpdb->prepare('SELECT %s', $_GET['a']));`), false);
  assert.equal(derived(`sink($this->wpdb->get_var($_GET['a']));`), false);
  assert.equal(derived(`$rows = $wpdb->get_results($_GET['a']); sink($rows);`), false);
  assert.equal(derived(`sink(wp_remote_get($_GET['u']));`), false);
  assert.equal(derived(`$r = wp_remote_get($_GET['u']); sink(wp_remote_retrieve_body($r));`), false);
  assert.equal(derived(`$id = wp_insert_post(array('post_title' => $_POST['t'])); sink($id);`), false);
  assert.equal(derived(`$id = wp_create_user($_POST['u'], $_POST['p']); $user = get_user_by('id', $id); sink($user->ID);`), false);
  assert.equal(derived(`$q = new WP_Query($_GET); sink($q);`), false);
  assert.equal(derived(`sink(get_current_user_id());`), false);
});

test('function parameters are not request sources', () => {
  assert.equal(derived(`$a = $param; sink($a);`), false);
});

test('host taint through concatenation and interpolation', () => {
  assert.equal(host(`sink($_GET['u']);`), true);
  assert.equal(host(`$u = $_GET['u']; sink($u);`), true);
  assert.equal(host(`sink($_GET['u'] . '/path');`), true);
  assert.equal(host(`sink("{$_GET['host']}/path");`), true);
  assert.equal(host(`sink('https://' . $_GET['host'] . '/path');`), true);
  assert.equal(host(`sink('https://api.example.test/' . $_GET['path']);`), false);
  assert.equal(host(`sink("https://api.example.test/$_GET[path]");`), false);
  assert.equal(host(`sink('/local/' . $_GET['path']);`), false);
  assert.equal(host(`sink(home_url('/x') . $_GET['p']);`), false);
  assert.equal(host(`sink(admin_url() . $_GET['p']);`), false);
  assert.equal(host(`sink(get_permalink($_GET['id']));`), false);
  assert.equal(host(`sink(add_query_arg('a', 'b', $_GET['u']));`), true);
  assert.equal(host(`sink(add_query_arg(array('a' => $_GET['a']), 'https://api.example.test/'));`), false);
  assert.equal(host(`sink(add_query_arg(array('a' => 'b'), $_GET['u']));`), true);
});

test('host taint passes through esc_url_raw, trim, urldecode, sanitize_text_field and string casts', () => {
  assert.equal(host(`sink(esc_url_raw($_GET['u']));`), true);
  assert.equal(host(`sink(trim($_GET['u']));`), true);
  assert.equal(host(`sink(urldecode($_GET['u']));`), true);
  assert.equal(host(`sink(sanitize_text_field(wp_unslash($_GET['u'])));`), true);
  assert.equal(host(`sink((string) $_GET['u']);`), true);
  assert.equal(host(`sink((int) $_GET['u']);`), false);
  assert.equal(host(`sink($request->get_param('u'));`), true);
  assert.equal(host(`sink($request->get_param('u'));`, { sources: ['superglobal'] }), false);
});

test('host validation between assignment and use kills the taint', () => {
  assert.equal(host(`$u = $_GET['u']; if (!wp_http_validate_url($u)) { return; } sink($u);`), false);
  assert.equal(host(`$u = $_GET['u']; wp_validate_redirect($u, home_url()); sink($u);`), false);
  assert.equal(host(`$u = $_GET['u']; $u = wp_validate_redirect($u, home_url()); sink($u);`), false);
  assert.equal(host(`$u = $_GET['u']; sink($u); wp_http_validate_url($u);`), true);
  assert.equal(host(`wp_http_validate_url($u); $u = $_GET['u']; sink($u);`), true);
  assert.equal(host(`$u = $_GET['u']; wp_http_validate_url($other); sink($u);`), true);
});

test('createScopeIndex is built once per scope and reused', () => {
  const { expr, idx } = probe(`$a = $_GET['a']; $b = $a; sink($b);`);
  assert.equal(isRequestDerived(expr, idx), true);
  assert.equal(isRequestDerived(expr, idx), true);
  assert.ok(idx.defs.has('a') && idx.defs.has('b') && idx.defs.has('param'));
});
