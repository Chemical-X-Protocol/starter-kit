// Unit spec for SECURITY_WP_AUTH_ERROR_CLEARED (task #6708): each callback form the pass resolves, and the shapes it must leave alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { wpAuthFiltersPass } from './wp-auth-filters.js';
import { AUTH_FILTER_SHAPES, AUTH_FILTER_SILENT } from '../fixtures/php/auth-filters.fixtures.js';

const run = (source, wp = { isWordPress: true, root: '/tmp/demo', kind: 'plugin' }) => {
  const ctx = buildPassContext(source, { path: '/tmp/demo/demo.php', wp, index: null });
  ctx.relativePath = 'demo.php';
  wpAuthFiltersPass(ctx);
  return ctx.records;
};

for (const [name, source] of Object.entries(AUTH_FILTER_SHAPES)) {
  test(`reports the ${name} callback form once`, () => {
    const records = run(source);
    assert.equal(records.length, 1);
    assert.equal(records[0].rule, 'SECURITY_WP_AUTH_ERROR_CLEARED');
  });
}

for (const [name, source] of Object.entries(AUTH_FILTER_SILENT)) {
  test(`stays silent for ${name}`, () => {
    assert.deepEqual(run(source), []);
  });
}

test('stays silent when the callback answers as a guest with wp_set_current_user( 0 )', () => {
  const source = `<?php
add_filter( 'rest_authentication_errors', function ( $error ) {
	if ( is_wp_error( $error ) && 'rest_cookie_invalid_nonce' === $error->get_error_code() ) {
		wp_set_current_user( 0 );
		return null;
	}
	return $error;
} );
`;
  assert.deepEqual(run(source), []);
});

test('stays silent outside WordPress', () => {
  assert.deepEqual(run(AUTH_FILTER_SHAPES.closureTrue, { isWordPress: false }), []);
});
