// Precision spec for SECURITY_WP_UNBOUNDED_REQUEST_ARRAY (design spec 2.6, task #6717). Figures measured 2026-10-25,
// labelled by one reader: corpus (674 files) 12 hits, 12 true; held-out card vault a708d6a 5/5 (including
// /collector/collection/sync and /intake/submit), third-party plugins 8/11; 13/16 in all. forminator, hustle, wp-defender,
// wpmu-dev-seo and wp-smush-pro were not measured. The rule ships default-off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditFiles } from '../fixtures/php/routes.fixtures.js';
import { wpUnboundedRequestArrayRegistration, RULE_DEFAULTS } from './wp-route-bounds.js';
import { BOUNDS_SHAPES, BOUNDS_SILENT } from '../fixtures/php/bounds.fixtures.js';

const RULE = 'SECURITY_WP_UNBOUNDED_REQUEST_ARRAY';
const found = (source) => auditFiles({ 'demo.php': source }, { passes: [wpUnboundedRequestArrayRegistration] }).filter((r) => r.rule === RULE);

test('every labelled shape fires once and every silent shape does not', () => {
  for (const [name, source] of Object.entries(BOUNDS_SHAPES)) assert.equal(found(source).length, 1, name);
  for (const [name, source] of Object.entries(BOUNDS_SILENT)) assert.equal(found(source).length, 0, name);
});

test('the report names the callback and says it is a name match', () => {
  const [hit] = found(BOUNDS_SHAPES.loopOverParam);
  assert.match(hit.hazard, /POST/);
  assert.match(hit.hazard, /a name match, not a proof/);
  assert.match(hit.evidence, /callback .*handle_sync/);
});

test('a callee in another file is followed, and its own cap silences the route', () => {
  const api = BOUNDS_SHAPES.callee.replace('self::store', 'Other_Class::store');
  const other = (cap) => `<?php\nclass Other_Class {\n public static function store( $user, $items ) {\n${cap}  foreach ( $items as $item ) {\n   update_user_meta( $user, 'i', $item );\n  }\n }\n}\n`;
  const run = (cap) => auditFiles({ 'demo.php': api, 'other.php': other(cap) }, { passes: [wpUnboundedRequestArrayRegistration] }).filter((r) => r.rule === RULE);
  assert.equal(run('').length, 1);
  assert.equal(run('  if ( count( $items ) > 100 ) { return false; }\n').length, 0);
});

test('the rule ships default-off with its measured figures declared', () => {
  assert.equal(RULE_DEFAULTS[RULE].defaultOn, false);
  assert.equal(RULE_DEFAULTS[RULE].corpus, '12/12');
  assert.equal(RULE_DEFAULTS[RULE].heldOut, '13/16');
});
