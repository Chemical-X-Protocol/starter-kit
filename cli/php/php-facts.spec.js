import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhp } from './php-parse.js';
import { extractFacts } from './php-facts.js';

function facts(src, path = 'plugin/inc/file.php') {
  const parsed = parsePhp(src);
  assert.ok(parsed.ast, 'parses');
  return extractFacts(parsed.ast, path);
}

const fn = (f, id) => f.functions.find((x) => x.id === id);
const byType = (f, type) => f.registrations.filter((r) => r.type === type);

const NAMESPACED = `<?php
namespace App\\Admin;

use Core\\Controller\\Ajax;
use Core\\Contracts\\Handler as Contract;
use Core\\Concerns\\Logs;

class Page extends Ajax implements Contract {
  use Logs;
  public function run() {
    $this->helper();
    self::stat();
    static::late();
    parent::boot();
    Other::make();
    $svc = new Service();
    $svc->go();
    $this->repo = new Repo();
    $this->repo->save();
    $unknown->nope();
    strlen('x');
  }
}
`;

test('a namespaced class extending an imported Controller\\Ajax resolves to the imported FQN', () => {
  const f = facts(NAMESPACED);
  const cls = f.classes[0];
  assert.equal(cls.fqn, 'App\\Admin\\Page');
  assert.equal(cls.extends, 'Core\\Controller\\Ajax');
  assert.deepEqual(cls.implements, ['Core\\Contracts\\Handler']);
  assert.deepEqual(cls.traits, ['Core\\Concerns\\Logs']);
  assert.deepEqual(cls.methods, ['App\\Admin\\Page::run']);
});

test('every receiver kind is recorded with its resolved target', () => {
  const f = facts(NAMESPACED);
  const calls = fn(f, 'App\\Admin\\Page::run').calls;
  const pick = (receiver, name) => calls.find((c) => c.receiver === receiver && c.name === name);
  assert.equal(pick('this', 'helper').target, 'App\\Admin\\Page::helper');
  assert.equal(pick('self', 'stat').target, 'App\\Admin\\Page::stat');
  assert.equal(pick('static', 'late').target, 'App\\Admin\\Page::late');
  assert.equal(pick('parent', 'boot').target, 'Core\\Controller\\Ajax::boot');
  assert.equal(pick('static-class', 'make').target, 'App\\Admin\\Other::make');
  assert.equal(pick('var-new', 'go').target, 'App\\Admin\\Service::go');
  assert.equal(pick('var-new', 'save').target, 'App\\Admin\\Repo::save', '$this->prop = new C in the class');
  assert.equal(pick('var', 'nope').target, null, 'an unknown variable has no target');
  assert.equal(pick('new', '__construct').target, 'App\\Admin\\Service::__construct');
  const strlen = pick('func', 'strlen');
  assert.equal(strlen.target, 'App\\Admin\\strlen');
  assert.equal(strlen.fallback, 'strlen', 'unqualified function calls keep the global fallback');
});

test('a global-namespace file keeps plain names and no fallback', () => {
  const f = facts('<?php\nclass K extends Base { function m() { helper(); parent::m(); } }\n');
  const calls = fn(f, 'K::m').calls;
  assert.equal(calls.find((c) => c.name === 'helper').target, 'helper');
  assert.equal(calls.find((c) => c.name === 'helper').fallback, null);
  assert.equal(calls.find((c) => c.receiver === 'parent').target, 'Base::m');
});

test('functions and methods carry ranges and parameters', () => {
  const f = facts('<?php\nfunction top(int $a, &$b, ...$rest) {\n  return 1;\n}\n');
  const top = fn(f, 'top');
  assert.equal(top.line, 2);
  assert.equal(top.endLine, 4);
  assert.deepEqual(top.params.map((p) => [p.name, p.byRef, p.variadic, p.type]), [
    ['a', false, false, 'int'],
    ['b', true, false, null],
    ['rest', false, true, null],
  ]);
});

test('state writes, outbound requests, auth checks, nonce checks and wpdb writes are labelled by name', () => {
  const f = facts(`<?php
function h() {
  check_ajax_referer('n');
  current_user_can('manage_options');
  update_option('a', 1);
  wp_insert_post([]);
  wp_remote_get($url);
  global $wpdb;
  $wpdb->insert('t', []);
  $wpdb->get_results('q');
  $this->verify_signature();
  $this->sanity_check();
}
`);
  const h = fn(f, 'h');
  assert.deepEqual(h.stateWrites.map((w) => w.name), ['update_option', 'wp_insert_post', 'insert']);
  assert.deepEqual(h.outboundRequests.map((w) => w.name), ['wp_remote_get']);
  assert.deepEqual(h.authChecks.map((w) => w.name), ['check_ajax_referer', 'current_user_can', 'verify_signature']);
  assert.deepEqual(h.nonceChecks.map((w) => w.name), ['check_ajax_referer', 'sanity_check']);
});

test('returnsTrueOnly is set for a body that is only `return true`, including closures and arrow functions', () => {
  const f = facts(`<?php
function open_perm() { return true; }
function busy() { log_it(); return true; }
add_action('x', function () { return true; });
add_action('y', fn() => true);
`);
  assert.equal(fn(f, 'open_perm').returnsTrueOnly, true);
  assert.equal(fn(f, 'busy').returnsTrueOnly, false);
  const closures = f.functions.filter((x) => x.kind === 'closure' || x.kind === 'arrowfunc');
  assert.deepEqual(closures.map((c) => c.returnsTrueOnly), [true, true]);
});

test('register_rest_route records literal namespace and route, argument lines and endpoint callables', () => {
  const f = facts(`<?php
register_rest_route(
  'shop/v1',
  '/orders',
  [
    ['methods' => WP_REST_Server::CREATABLE, 'callback' => 'make_order', 'permission_callback' => '__return_true'],
    ['methods' => 'GET, HEAD', 'callback' => [new Orders(), 'list'], 'permission_callback' => fn() => true],
  ]
);
register_rest_route($ns, $route . '/x', ['callback' => 'cb']);
`);
  const [first, second] = byType(f, 'rest_route');
  assert.equal(first.namespace, 'shop/v1');
  assert.equal(first.route, '/orders');
  assert.deepEqual(first.args.map((a) => a.line), [3, 4, 5]);
  assert.equal(first.endpoints.length, 2);
  assert.deepEqual(first.endpoints[0].methods, ['POST']);
  assert.equal(first.endpoints[0].callback.function, 'make_order');
  assert.equal(first.endpoints[0].permission.function, '__return_true');
  assert.deepEqual(first.endpoints[1].methods, ['GET', 'HEAD']);
  assert.equal(first.endpoints[1].permission.returnsTrueOnly, true);
  assert.equal(second.namespace, null, 'a non-literal namespace is not guessed');
  assert.equal(second.route, null);
  assert.equal(second.endpoints.length, 1, 'a single endpoint array is accepted');
});

test('add_action and add_filter record literal hook names; loader ->add_action resolves the object class', () => {
  const f = facts(`<?php
namespace Plug;
class Boot {
  function init($loader) {
    add_action('init', [$this, 'setup']);
    add_filter('the_title', 'Plug\\\\Titles::fix', 20, 1);
    $admin = new Admin();
    $loader->add_action('admin_menu', $admin, 'menu');
    $this->loader->add_action('wp_ajax_save', $this, 'save');
    add_action('wp_ajax_' . $kind, 'dyn');
  }
}
`);
  const hooks = byType(f, 'hook');
  const by = (hook) => hooks.find((h) => h.hook === hook);
  assert.equal(by('init').via, 'function');
  assert.equal(by('init').callback.target, 'Plug\\Boot::setup');
  assert.equal(by('the_title').function, 'add_filter');
  assert.equal(by('the_title').callback.target, 'Plug\\Titles::fix');
  assert.equal(by('admin_menu').via, 'method');
  assert.equal(by('admin_menu').callback.target, 'Plug\\Admin::menu');
  assert.equal(by('wp_ajax_save').ajax, 'wp_ajax');
  assert.equal(by('wp_ajax_save').callback.target, 'Plug\\Boot::save');
  const dynamic = hooks.find((h) => h.hook === null);
  assert.equal(dynamic.hookPrefix, 'wp_ajax_');
  assert.equal(dynamic.ajax, 'wp_ajax');
  assert.equal(by('init').in, 'Plug\\Boot::init');
});

test('wp_ajax_* and admin_post_* map entries are recorded with their handlers', () => {
  const f = facts(`<?php
class Map {
  function handlers() {
    return [
      'wp_ajax_one' => 'handle_one',
      'wp_ajax_nopriv_two' => [$this, 'two'],
      'admin_post_three' => [self::class, 'three'],
      'other_key' => 'ignored',
    ];
  }
}
`);
  const entries = byType(f, 'hook_map');
  assert.deepEqual(entries.map((e) => [e.hook, e.ajax]), [
    ['wp_ajax_one', 'wp_ajax'],
    ['wp_ajax_nopriv_two', 'wp_ajax_nopriv'],
    ['admin_post_three', 'admin_post'],
  ]);
  assert.equal(entries[0].callback.function, 'handle_one');
  assert.equal(entries[1].callback.target, 'Map::two');
  assert.equal(entries[2].callback.target, 'Map::three');
});

test('each string callable shape resolves, including the concatenation forms', () => {
  const f = facts(`<?php
namespace N;
use Lib\\Thing;
class C {
  function reg() {
    add_action('a1', 'plain_fn');
    add_action('a2', 'Lib\\\\Cls::meth');
    add_action('a3', ['Lib\\\\Cls', 'meth']);
    add_action('a4', [$this, 'm4']);
    add_action('a5', [self::class, 'm5']);
    add_action('a6', array(__CLASS__, 'm6'));
    add_action('a7', __CLASS__ . '::m7');
    add_action('a8', Thing::class . '::m8');
    add_action('a9', [Thing::class, 'm9']);
    add_action('a10', [$unknown, 'm10']);
  }
}
`);
  const cb = (hook) => byType(f, 'hook').find((h) => h.hook === hook).callback;
  assert.equal(cb('a1').function, 'plain_fn');
  assert.equal(cb('a2').target, 'Lib\\Cls::meth');
  assert.equal(cb('a3').target, 'Lib\\Cls::meth');
  assert.equal(cb('a4').target, 'N\\C::m4');
  assert.equal(cb('a4').viaThis, true);
  assert.equal(cb('a5').target, 'N\\C::m5');
  assert.equal(cb('a6').target, 'N\\C::m6');
  assert.equal(cb('a7').target, 'N\\C::m7');
  assert.equal(cb('a7').form, 'concat');
  assert.equal(cb('a8').target, 'Lib\\Thing::m8', 'X::class resolves through use imports');
  assert.equal(cb('a9').target, 'Lib\\Thing::m9');
  assert.equal(cb('a10').target, null, 'an unknown variable class is not guessed');
  assert.equal(cb('a10').method, 'm10');
});

test('closures become their own function entries and registrations point at them', () => {
  const f = facts(`<?php
add_action('x', function () { update_option('a', 1); });
`);
  const reg = byType(f, 'hook')[0];
  assert.equal(reg.callback.form, 'closure');
  const closure = fn(f, reg.callback.closureId);
  assert.ok(closure, 'closure id resolves to a function entry');
  assert.deepEqual(closure.stateWrites.map((w) => w.name), ['update_option']);
});

test('facts are plain data: JSON round trip is lossless', () => {
  const f = facts(NAMESPACED);
  assert.deepEqual(JSON.parse(JSON.stringify(f)), f);
});
