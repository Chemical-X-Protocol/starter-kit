// Precision spec for SECURITY_WP_PUBLIC_REGISTRATION_ROUTE (design spec 2.6, task #6709). Figures measured 2026-10-25.
// The rule without its route-name filter reported 12 routes that reach a user-creating call with no registration
// setting text: 7 on routes not named for registration (passwordless code in two files, OAuth token, magic link,
// checkout verify, payment webhook, a contact-form submission; the first six create the account as a side effect of
// signing in or paying, the contact form was not read closely) and 5 on routes named for registration or user creation. With the filter: corpus (674 files) 2 hits, 2 TP; held-out: card vault a708d6a 1 TP,
// card vault ae81b02 0 hits, own plugins outside the corpus 2 TP, third-party plugins (vendor/ excluded, 15152 files
// under wp-content/plugins outside the corpus) 0 hits. TP = the route creates an account and never reads
// users_can_register or a registration setting (a real hole, or intentionally public and so due a chemx-allow reason).
// Both figures rest on fewer than the 10 hits the bar names, so the rule ships default-off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditFiles } from '../fixtures/php/routes.fixtures.js';
import { wpRegistrationRegistration } from './wp-registration.js';
import { REGISTRATION_SHAPES, REGISTRATION_SILENT } from '../fixtures/php/registration.fixtures.js';

const RULE = 'SECURITY_WP_PUBLIC_REGISTRATION_ROUTE';
const fires = (source, options) => auditFiles({ 'demo.php': source }, { passes: [wpRegistrationRegistration], ...options }).some((r) => r.rule === RULE);

const CASES = [
  { name: 'captcha-only register route (card vault a708d6a /auth/register)', origin: 'held-out', weight: 1, source: REGISTRATION_SHAPES.captchaOnly },
  { name: 'register route calling wp_insert_user (kitchen-synk style)', origin: 'held-out', weight: 2, source: REGISTRATION_SHAPES.insertUser },
  { name: 'registration route with the create two hops down (event-horizon /register)', origin: 'corpus', weight: 1, source: REGISTRATION_SHAPES.twoHopsDown },
  { name: 'anonymous create-user from a contact (quests /contacts/{id}/create-user)', origin: 'corpus', weight: 1, source: REGISTRATION_SHAPES.createUserRoute },
];

test('every labelled shape fires and every silent shape does not', () => {
  for (const c of CASES) assert.equal(fires(c.source), true, c.name);
  for (const [name, source] of Object.entries(REGISTRATION_SILENT)) assert.equal(fires(source), false, name);
});

test('corpus: 2 of 2 labelled hits are TP; held-out: 3 of 3 (below the 10 hits the bar names, so the rule ships off)', () => {
  const total = (origin) => CASES.filter((c) => c.origin === origin).reduce((sum, c) => sum + c.weight, 0);
  assert.equal(total('corpus'), 2);
  assert.equal(total('held-out'), 3);
});

test('crossFile false hides a create or a setting held in another file: a one-file route is still reported', () => {
  assert.equal(fires(REGISTRATION_SHAPES.captchaOnly, { crossFile: false }), true);
});

test('a setting read in a second file is found through the project index', () => {
  const files = {
    'demo.php': REGISTRATION_SHAPES.captchaOnly.replace("'demo_signup'", "array( 'Demo_Gate', 'signup' )"),
    'gate.php': "<?php\nclass Demo_Gate {\n\tpublic static function signup( $request ) {\n\t\tif ( ! get_option( 'users_can_register' ) ) {\n\t\t\treturn null;\n\t\t}\n\t\treturn wp_create_user( 'a', 'b' );\n\t}\n}\n",
  };
  assert.equal(auditFiles(files, { passes: [wpRegistrationRegistration] }).some((r) => r.rule === RULE), false);
});
