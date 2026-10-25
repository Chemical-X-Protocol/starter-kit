import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getProjectIndex, resetProjectIndexCache, setProjectIndexClock, INDEX_MAX_FILES, prefilterPhp } from './wp-project-index.js';

let root;
let now;
let previousClock;

beforeEach(() => {
  resetProjectIndexCache();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-wp-index-')));
  now = 1_000_000;
  previousClock = setProjectIndexClock(() => now);
});

afterEach(() => {
  setProjectIndexClock(previousClock);
  resetProjectIndexCache();
  fs.rmSync(root, { recursive: true, force: true });
});

function put(rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return full;
}

function git(...args) {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
}

const BASE = `<?php
namespace Core\\Base;
abstract class Controller {
  public function guard() { check_ajax_referer('core'); }
}
`;

const TRAIT = `<?php
namespace Core\\Concerns;
trait Logs {
  public function log_it() { error_log('x'); }
}
`;

const PAGE = `<?php
namespace App\\Admin;
use Core\\Base\\Controller;
use Core\\Concerns\\Logs;
class Page extends Controller {
  use Logs;
  public function boot() {
    add_action('wp_ajax_guard', [$this, 'guard']);
    add_action('wp_ajax_log', array($this, 'log_it'));
    add_action('wp_ajax_handle', __CLASS__ . '::handle');
  }
  public static function handle() { return 1; }
}
`;

const PLUGIN = `<?php
/**
 * Plugin Name: Demo
 */
class Demo_Plugin {
  private $loader;
  public function define_hooks() {
    $component = new Demo_Admin();
    $this->loader->add_action('admin_init', $component, 'on_init');
  }
}
`;

const ADMIN = `<?php
class Demo_Admin {
  public function on_init() { $this->step(); }
  private function step() { $this->on_init(); demo_verify(); }
}
`;

const FUNCTIONS = `<?php
function demo_verify() { wp_verify_nonce($_POST['n'] ?? '', 'demo'); }
`;

const UNUSED = `<?php
class Demo_Unused {
  public function idle() { return 2; }
}
`;

const MAP = `<?php
class Demo_Map {
  public $action_hooks = [ 'wp_ajax_demo_map' => 'handleMap' ];
  public function handleMap() { return 1; }
}
`;

function seedRepo() {
  git('init', '-q');
  put('.gitignore', 'ignored/\n');
  put('demo.php', PLUGIN);
  put('includes/base/class-controller.php', BASE);
  put('includes/concerns/trait-logs.php', TRAIT);
  put('includes/admin/class-page.php', PAGE);
  put('includes/class-demo-admin.php', ADMIN);
  put('includes/functions.php', FUNCTIONS);
  put('includes/class-demo-unused.php', UNUSED);
  put('includes/class-demo-map.php', MAP);
  put('ignored/secret.php', '<?php\nclass Hidden { function h() { add_action("x", "y"); } }\n');
  put('vendor/lib/dep.php', '<?php\nclass Dep {}\n');
  git('add', '-A');
  git('add', '-f', 'vendor/lib/dep.php');
}

const hookCallback = (index, hook) => index.registrations().find((r) => r.hook === hook);

test('files: git-ignored and tracked vendor/ files are never listed', () => {
  seedRepo();
  const files = getProjectIndex(root).files();
  assert.ok(files.includes('includes/admin/class-page.php'));
  assert.ok(!files.some((f) => f.startsWith('ignored/')), 'ignored dir never listed');
  assert.ok(!files.some((f) => f.startsWith('vendor/')), 'tracked vendor/ excluded');
});

test('files: an untracked file created later is listed after the 30 s re-list window', () => {
  seedRepo();
  getProjectIndex(root);
  put('includes/class-late.php', '<?php\nclass Late {}\n');
  assert.ok(!getProjectIndex(root).files().includes('includes/class-late.php'), 'cached list inside the window');
  now += 30_001;
  assert.ok(getProjectIndex(root).files().includes('includes/class-late.php'));
});

test('files: a change of the git index mtime triggers a re-list', () => {
  seedRepo();
  getProjectIndex(root);
  put('includes/class-staged.php', '<?php\nclass Staged {}\n');
  git('add', 'includes/class-staged.php');
  const future = new Date(Date.now() + 5_000);
  fs.utimesSync(path.join(root, '.git', 'index'), future, future);
  assert.ok(getProjectIndex(root).files().includes('includes/class-staged.php'));
});

test('files: outside git a walk skips vendor/ and node_modules/', () => {
  put('a.php', '<?php\n');
  put('vendor/b.php', '<?php\n');
  put('node_modules/pkg/c.php', '<?php\n');
  assert.deepEqual(getProjectIndex(root).files(), ['a.php']);
});

test('resolveCallable: [$this, m] through a parent class in another namespace and through a trait', () => {
  seedRepo();
  const index = getProjectIndex(root);
  const guard = hookCallback(index, 'wp_ajax_guard');
  const viaParent = index.resolveCallable(guard.callback, guard.file);
  assert.equal(viaParent.id, 'Core\\Base\\Controller::guard');
  assert.equal(viaParent.file, 'includes/base/class-controller.php');
  const log = hookCallback(index, 'wp_ajax_log');
  const viaTrait = index.resolveCallable(log.callback, log.file);
  assert.equal(viaTrait.id, 'Core\\Concerns\\Logs::log_it');
  assert.equal(viaTrait.file, 'includes/concerns/trait-logs.php');
});

test('resolveCallable: __CLASS__ . "::m" and string callables resolve', () => {
  seedRepo();
  const index = getProjectIndex(root);
  const handle = hookCallback(index, 'wp_ajax_handle');
  assert.equal(index.resolveCallable(handle.callback, handle.file).id, 'App\\Admin\\Page::handle');
  assert.equal(index.resolveCallable('App\\Admin\\Page::handle').file, 'includes/admin/class-page.php');
  assert.equal(index.resolveCallable('demo_verify').file, 'includes/functions.php');
  assert.equal(index.resolveCallable('no_such_function'), null);
});

test('resolveCallable: loader add_action with $component = new C', () => {
  seedRepo();
  const index = getProjectIndex(root);
  const reg = hookCallback(index, 'admin_init');
  assert.equal(reg.callback.form, 'loader');
  const hit = index.resolveCallable(reg.callback, reg.file);
  assert.equal(hit.id, 'Demo_Admin::on_init');
  assert.equal(hit.file, 'includes/class-demo-admin.php');
});

test('resolveRegistration: a hook-map string with no such function names a method of the map class', () => {
  seedRepo();
  const index = getProjectIndex(root);
  const reg = index.registrations().find((r) => r.type === 'hook_map');
  assert.equal(reg.callback.form, 'function');
  assert.equal(index.resolveCallable(reg.callback, reg.file), null, 'as a plain callable the string names a function');
  const [entry] = index.resolveRegistration(reg);
  assert.equal(entry.role, 'callback');
  assert.equal(entry.target.id, 'Demo_Map::handleMap');
});

test('prefilterPhp: namespaces, qualified declarations and registration keywords without a parse', () => {
  const pre = prefilterPhp(PAGE);
  assert.deepEqual(pre.namespaces, ['App\\Admin']);
  assert.deepEqual(pre.classes, ['App\\Admin\\Page']);
  assert.deepEqual(pre.functions, [], 'methods with a visibility modifier are not function declarations');
  assert.deepEqual(prefilterPhp(FUNCTIONS).functions, ['demo_verify']);
  assert.equal(pre.registers, true);
  assert.equal(prefilterPhp(UNUSED).registers, false);
});

test('reaches: finds a nonce check two hops away, not one, and survives a call cycle', () => {
  seedRepo();
  const index = getProjectIndex(root);
  const reg = hookCallback(index, 'admin_init');
  const hasNonce = (fact) => fact.nonceChecks.length > 0;
  const found = index.reaches(reg.callback, hasNonce, { hops: 2, fromFile: reg.file });
  assert.equal(found.id, 'demo_verify');
  assert.equal(found.depth, 2);
  assert.deepEqual(found.path.map((p) => p.id), ['Demo_Admin::on_init', 'Demo_Admin::step', 'demo_verify']);
  assert.equal(index.reaches(reg.callback, hasNonce, { hops: 1, fromFile: reg.file }), null);
  assert.equal(index.reaches(reg.callback, () => false, { hops: 50, fromFile: reg.file }), null, 'cycle-safe');
});

test('dependentsOf: returns the file whose registration resolves into the target', () => {
  seedRepo();
  const index = getProjectIndex(root);
  assert.deepEqual(index.dependentsOf('includes/class-demo-admin.php'), ['demo.php']);
  assert.deepEqual(index.dependentsOf('includes/base/class-controller.php'), ['includes/admin/class-page.php']);
  assert.deepEqual(index.dependentsOf('includes/functions.php'), ['includes/class-demo-admin.php']);
});

test('registrationsFor: own registrations plus those elsewhere that resolve into the file, parsing only candidates', () => {
  seedRepo();
  const index = getProjectIndex(root);
  const regs = index.registrationsFor('includes/class-demo-admin.php');
  assert.deepEqual(regs.map((r) => `${r.file}:${r.hook}`), ['demo.php:admin_init']);
  assert.ok(!index.parsedFiles().includes('includes/admin/class-page.php'), 'a registering file that cannot name the target is not parsed');
  const own = index.registrationsFor('includes/admin/class-page.php').map((r) => r.hook);
  assert.deepEqual(own, ['wp_ajax_guard', 'wp_ajax_log', 'wp_ajax_handle']);
});

test('overlay: content passed in replaces the disk content of one file', () => {
  seedRepo();
  const renamed = ADMIN.replace(/on_init/g, 'on_boot');
  const overlaid = getProjectIndex(root, { overlay: { relativePath: 'includes/class-demo-admin.php', content: renamed } });
  const reg = hookCallback(overlaid, 'admin_init');
  assert.equal(overlaid.resolveCallable(reg.callback, reg.file), null, 'on_init is gone in the overlay');
  assert.ok(overlaid.facts('includes/class-demo-admin.php').classes[0].methods.includes('Demo_Admin::on_boot'));
  const plain = getProjectIndex(root);
  assert.equal(plain.resolveCallable(reg.callback, reg.file).id, 'Demo_Admin::on_init', 'disk content unchanged');
});

test('prefilter: a file with no registrations and no referenced class is never parsed', () => {
  seedRepo();
  const index = getProjectIndex(root);
  for (const reg of index.registrations()) index.resolveCallable(reg.callback, reg.file);
  const reg = hookCallback(index, 'admin_init');
  index.reaches(reg.callback, () => false, { fromFile: reg.file });
  assert.ok(index.prefilter('includes/class-demo-unused.php').classes.includes('Demo_Unused'));
  assert.ok(!index.parsedFiles().includes('includes/class-demo-unused.php'));
  assert.ok(index.parsedFiles().includes('includes/class-demo-admin.php'));
});

test('invalidation: an mtime change rebuilds that one entry only', () => {
  seedRepo();
  const index = getProjectIndex(root);
  const files = index.files();
  for (const rel of files) index.facts(rel);
  const before = index.stats().factsBuilt;
  const full = put('includes/class-demo-admin.php', ADMIN.replace(/step/g, 'next'));
  const future = new Date(Date.now() + 10_000);
  fs.utimesSync(full, future, future);
  const after = getProjectIndex(root);
  for (const rel of files) after.facts(rel);
  assert.equal(after.stats().factsBuilt, before + 1);
  assert.ok(after.facts('includes/class-demo-admin.php').classes[0].methods.includes('Demo_Admin::next'));
});

test('cap: a 401-file root holds only the audited file and reports capped', () => {
  for (let i = 0; i <= INDEX_MAX_FILES; i += 1) put(`gen/f${i}.php`, `<?php\nclass Gen${i} {}\n`);
  const index = getProjectIndex(root, { overlay: { relativePath: 'gen/f0.php', content: '<?php\nclass Gen0 {}\n' } });
  assert.equal(index.capped, true);
  assert.deepEqual(index.files(), ['gen/f0.php']);
  assert.equal(index.resolveCallable('Gen1::x'), null);
});

test('cap: more than 8 MB of PHP source also caps the index', () => {
  const big = `<?php\n${'// filler line for the byte cap\n'.repeat(140_000)}`;
  put('a.php', big);
  put('b.php', big);
  assert.equal(getProjectIndex(root).capped, true);
});
