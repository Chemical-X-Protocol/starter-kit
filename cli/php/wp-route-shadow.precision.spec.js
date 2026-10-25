// Precision spec for SECURITY_WP_SHADOWED_ROUTE (design spec 2.6, task #6711). Figures measured 2026-10-25 over the
// route files of: the labelled corpus (674 files, 101 with routes) 0 hits; held-out card vault a708d6a 1 hit and it is
// true (POST /catalog/cards/prices after the EDITABLE /catalog/cards/(?P<id>[a-zA-Z0-9-_]+) route, both inside a
// foreach over $namespaces); card vault ae81b02 0 hits; third-party plugins under wp-content/plugins (vendor/ excluded)
// 0 hits; own plugins outside the corpus 0 hits. One hit is under the 10 the bar names, so the rule ships default-off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditFiles } from '../fixtures/php/routes.fixtures.js';
import { wpShadowedRouteRegistration } from './wp-route-shadow.js';
import { SHADOW_SHAPES, SHADOW_SILENT } from '../fixtures/php/shadow.fixtures.js';

const RULE = 'SECURITY_WP_SHADOWED_ROUTE';
const found = (source) => auditFiles({ 'demo.php': source }, { passes: [wpShadowedRouteRegistration] }).filter((r) => r.rule === RULE);

test('every labelled shape fires once and every silent shape does not', () => {
  for (const [name, source] of Object.entries(SHADOW_SHAPES)) assert.equal(found(source).length, 1, name);
  for (const [name, source] of Object.entries(SHADOW_SILENT)) assert.equal(found(source).length, 0, name);
});

test('the report names both routes and anchors at the later registration', () => {
  const [hit] = found(SHADOW_SHAPES.postAfterEditable);
  assert.match(hit.evidence, /items\/\(\?P<id>.*matches \/items\/prices/);
  assert.match(hit.hazard, /\/items\/prices \(POST\) is registered after/);
  assert.equal(hit.line, 12);
});

test('held-out: 1 of 1 hit true (card vault a708d6a); corpus 0 hits. The rule is default-off', async () => {
  const { RULE_DEFAULTS } = await import('./wp-route-rules.js');
  assert.equal(RULE_DEFAULTS[RULE].defaultOn, false);
  assert.equal(RULE_DEFAULTS[RULE].heldOut, '1/1');
});
