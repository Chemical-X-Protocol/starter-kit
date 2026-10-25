// Precision spec for SECURITY_WP_AUTH_ERROR_CLEARED (design spec 2.6, task #6708). Each case is a corpus or held-out
// hit reduced to its distinct form with generic names. Figures measured 2026-10-25: corpus (674 files) 6 hits, 6 TP;
// held-out: card vault a708d6a 1 TP, card vault ae81b02 0 hits, own plugin outside the corpus 1 TP, third-party
// plugins (vendor/ excluded, 15917 files under wp-content/plugins) 0 hits. label TP = a real clearing callback;
// label SILENT = a shape the pass must not report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { wpAuthFiltersPass } from './wp-auth-filters.js';
import { AUTH_FILTER_SHAPES, AUTH_FILTER_SILENT } from '../fixtures/php/auth-filters.fixtures.js';

const CASES = [
  { name: 'method returns null on a nonce error (card vault a708d6a)', origin: 'held-out', label: 'TP', weight: 1, source: AUTH_FILTER_SHAPES.methodNull },
  { name: 'closure returns true on a nonce error (own plugin outside the corpus)', origin: 'held-out', label: 'TP', weight: 1, source: AUTH_FILTER_SHAPES.closureTrue },
  { name: 'closure returns true on a nonce error for one route (corpus: 2 plugins)', origin: 'corpus', label: 'TP', weight: 2, source: AUTH_FILTER_SHAPES.closureTrue },
  { name: 'method returns null on a nonce error for one route (corpus: 2 plugins)', origin: 'corpus', label: 'TP', weight: 2, source: AUTH_FILTER_SHAPES.methodNull },
  { name: 'closure returns null for a request path with no error test (corpus)', origin: 'corpus', label: 'TP', weight: 1, source: AUTH_FILTER_SHAPES.pathOnlyNull },
  { name: 'method returns null on a login route (corpus)', origin: 'corpus', label: 'TP', weight: 1, source: AUTH_FILTER_SHAPES.shortArrayStatic },
  ...Object.entries(AUTH_FILTER_SILENT).map(([name, source]) => ({ name, origin: 'shape', label: 'SILENT', weight: 0, source })),
  {
    name: 'card vault HEAD: answers as a guest before returning null (corpus, skipped)',
    origin: 'shape',
    label: 'SILENT',
    weight: 0,
    source: `<?php
class Demo_Api {
	public function __construct() {
		add_filter( 'rest_authentication_errors', array( $this, 'demo_bypass' ), 999 );
	}
	public function demo_bypass( $error ) {
		if ( is_wp_error( $error ) && 'rest_cookie_invalid_nonce' === $error->get_error_code() ) {
			wp_set_current_user( 0 );
			return null;
		}
		return $error;
	}
}
`,
  },
];

const fires = (source) => {
  const ctx = buildPassContext(source, { path: '/tmp/demo/demo.php', wp: { isWordPress: true, root: '/tmp/demo', kind: 'plugin' }, index: null });
  ctx.relativePath = 'demo.php';
  wpAuthFiltersPass(ctx);
  return ctx.records.length > 0;
};

const results = CASES.map((c) => ({ ...c, fired: fires(c.source) }));
const precision = (origin) => {
  const fired = results.filter((r) => r.fired && r.weight > 0 && r.origin === origin);
  const total = fired.reduce((sum, r) => sum + r.weight, 0);
  const correct = fired.filter((r) => r.label === 'TP').reduce((sum, r) => sum + r.weight, 0);
  return { correct, total, ratio: total === 0 ? 1 : correct / total };
};

test('every TP shape fires and every SILENT shape does not', () => {
  for (const r of results) assert.equal(r.fired, r.label === 'TP', `${r.name}: fired=${r.fired}`);
});

test('weighted precision is at least 80% on the corpus cases and on the held-out cases', () => {
  const corpus = precision('corpus');
  const heldOut = precision('held-out');
  assert.equal(corpus.total, 6);
  assert.ok(corpus.ratio >= 0.8, `corpus ${corpus.correct}/${corpus.total}`);
  assert.equal(heldOut.total, 2);
  assert.ok(heldOut.ratio >= 0.8, `held-out ${heldOut.correct}/${heldOut.total}`);
});
