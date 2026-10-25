import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NONCE_SHAPES, NONCE_SILENT, NONCE_FIXTURE, NONCE_NAMESPACED_BAD, writePlugin, auditPlugin } from '../fixtures/php/nonce.fixtures.js';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { wpNoncePass, wpNonceRegistration } from './wp-nonce.js';

const RULE = 'SECURITY_WP_MISSING_NONCE';

function audit(files, options) {
  const plugin = writePlugin(files);
  try {
    return auditPlugin(plugin.root, options);
  } finally {
    plugin.cleanup();
  }
}

test('u2 pair: the bad plugin fires at the handler declaration, the good one is silent', () => {
  const [hit, ...rest] = audit({ 'demo.php': NONCE_FIXTURE.bad });
  assert.equal(rest.length, 0);
  assert.equal(hit.rule, RULE);
  assert.equal(hit.line, 6);
  assert.match(hit.hazard, /wp_ajax_demo_save at demo\.php:5/);
  assert.match(hit.evidence, /demo\.php:5 \(wp_ajax_demo_save\).*update_option\(\) at demo\.php:7/);
  assert.equal(hit.crossFile, false);
  assert.deepEqual(audit(NONCE_SILENT.good), []);
});

test('registration shapes: add_action, admin_post, nopriv, loader, hook map and [$this, method] all fire', () => {
  for (const [shape, files] of Object.entries(NONCE_SHAPES)) {
    const hits = audit(files);
    assert.equal(hits.length, 1, `${shape}: ${JSON.stringify(hits)}`);
    assert.equal(hits[0].rule, RULE);
  }
});

test('registration and callback in different files: the finding sits in the callback file and is crossFile', () => {
  const hits = audit(NONCE_SHAPES.crossFile);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, 'includes/handlers.php');
  assert.equal(hits[0].line, 2);
  assert.equal(hits[0].crossFile, true);
  assert.match(hits[0].evidence, /demo\.php:/);
  const loader = audit(NONCE_SHAPES.loader);
  assert.equal(loader[0].file, 'includes/class-demo-admin.php');
  assert.equal(loader[0].crossFile, true);
});

test('crossFile false drops registrations that live in another file', () => {
  assert.deepEqual(audit(NONCE_SHAPES.crossFile, { crossFile: false }), []);
  assert.equal(audit(NONCE_SHAPES.addAction, { crossFile: false }).length, 1);
});

test('a write two hops away fires; the nonce check may also sit in a helper', () => {
  assert.equal(audit(NONCE_SHAPES.twoHopWrite).length, 1);
  assert.deepEqual(audit(NONCE_SILENT.nonceInHelper), []);
});

test('silent shapes: read-only handler, nonce-named call, non-handler hook, namespaced parent holding the check', () => {
  for (const name of ['readOnly', 'nonceNamedCall', 'notAHandler', 'parentHoldsCheck']) {
    assert.deepEqual(audit(NONCE_SILENT[name]), [], name);
  }
});

test('the same namespaced child fires when the parent holds no check', () => {
  const hits = audit(NONCE_NAMESPACED_BAD);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, 'includes/class-page.php');
  assert.equal(hits[0].crossFile, true);
});

test('two registrations of one handler give one finding that counts the other', () => {
  const both = { 'demo.php': `<?php
add_action( 'wp_ajax_demo_save', 'demo_save' );
add_action( 'wp_ajax_nopriv_demo_save', 'demo_save' );
function demo_save() { update_option( 'a', 'b' ); }
` };
  const hits = audit(both);
  assert.equal(hits.length, 1);
  assert.match(hits[0].evidence, /and 1 more/);
});

test('without WordPress or an index the pass reports nothing', () => {
  const ctx = buildPassContext(NONCE_FIXTURE.bad, { wp: { isWordPress: false }, index: null });
  wpNoncePass(ctx);
  assert.equal(ctx.records.length, 0);
});

test('registration entry is WordPress-only and names its rule', () => {
  assert.deepEqual(wpNonceRegistration.rules, [RULE]);
  assert.equal(wpNonceRegistration.isWordPress, true);
});
