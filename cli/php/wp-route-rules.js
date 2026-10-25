// WordPress REST route rules (design spec 4): SECURITY_WP_PUBLIC_WRITE_ROUTE, SECURITY_WP_REST_NO_PERMISSION_CALLBACK
// and SECURITY_WP_PUBLIC_READ_SIDE_EFFECT. A pass is (ctx) => void and reports only through ctx.report. The
// effect and guard checks are name matches over the project index within 2 hops, not proof of behavior.
// Dark until the language flip registers .php.
import { resolveRestRoutes, indexPathOf, PUBLIC_KINDS } from './wp-rest-endpoints.js';
import { RULE_DEFAULTS as SHADOW_DEFAULTS, wpShadowedRouteRegistration } from './wp-route-shadow.js';
import { RULE_DEFAULTS as BOUNDS_DEFAULTS, wpUnboundedRequestArrayRegistration } from './wp-route-bounds.js';

const WRITE_ROUTE = 'SECURITY_WP_PUBLIC_WRITE_ROUTE';
const NO_PERMISSION = 'SECURITY_WP_REST_NO_PERMISSION_CALLBACK';
const READ_EFFECT = 'SECURITY_WP_PUBLIC_READ_SIDE_EFFECT';
const HOPS = 2;
const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Figures are in cli/php/wp-routes.precision.spec.js. The held-out entries say what was and was not measured.
export const RULE_DEFAULTS = {
  // Held-out: card vault HEAD aa27938 gave 1 hit (intentionally public); akismet, WooCommerce controllers and API,
  // snapshot-backups, code-snippets and wp-hummingbird gave 0. wp-defender, forminator, hustle, wpmu-dev-seo and
  // wp-smush-pro exceed the project index cap, so only callbacks in the audited file resolved there (0 hits).
  // The held-out figure rests on one hit, well under the 10 the bar names.
  // Task #6696 (2026-10-25) narrowed the guard: an auth-like call used only as data, and verify_/validate_ methods
  // named for business data, no longer count. That added 3 real corpus hits (card vault a708d6a /pos/checkout and
  // /pos/verify-payment, quests contact log) and no held-out hit.
  // Task #6712: severity is HIGH when any effect within 2 hops is a record or session write by name (wp_insert_*,
  // wp_update_*, wp_delete_*, wp_create_user, login cookie calls, $wpdb insert/update/delete/replace), else MEDIUM.
  // On the 25 corpus shapes 8 weigh HIGH (6 real, 2 intentional) and 17 MEDIUM. Not lifted: card vault a708d6a
  // Task #6718: calls to set_status, update_status or payment_complete on an unresolved variable also weigh HIGH
  // (WooCommerce order state), which lifts card vault a708d6a /pos/checkout and /pos/verify-payment. Not lifted:
  // /scan-card, /grade-card (outbound requests only). Precision figures below are unchanged by the split.
  [WRITE_ROUTE]: { defaultOn: true, corpus: '22/25 directive, 14/25 real holes', heldOut: '1/1', measured: '2026-10-25' },
  [NO_PERMISSION]: { defaultOn: true, corpus: '0 hits of 570 endpoints', heldOut: '0 hits on 281 endpoints (akismet, WooCommerce controllers and API)', measured: '2026-10-24' },
  [READ_EFFECT]: { defaultOn: false, corpus: '5/8', heldOut: 'not labelled (5 hits unlabelled: card vault 4, WooCommerce 1)', measured: '2026-10-24' },
  ...SHADOW_DEFAULTS,
  ...BOUNDS_DEFAULTS,
};

const isWordPressFile = (ctx) => Boolean(ctx.wp) && ctx.wp.isWordPress === true;
const hasWriteVerb = (endpoint) => endpoint.methods.verbs.some((v) => WRITE_VERBS.has(v));
// Task #6707: permission kind 'callable_fail_open' is deliberately not public here. Measured 2026-10-25: 0 corpus hits;
// held-out 1 callable (8 routes, card vault a708d6a check_read_permission, true) and 0 hits on card vault ae81b02 and
// 23 third-party plugins. Far under the 10 hits the bar names, so no rule acts on it yet.
const isPublic = (endpoint) => PUBLIC_KINDS.has(endpoint.permission.kind);

// Task #6718: WooCommerce order state changes are method calls on an unresolved variable ($order->set_status(),
// update_status(), payment_complete()). Name match on those three only, so a generic save() never counts. Used for
// severity only: it never makes a route a candidate, and no other rule reads it.
const ORDER_STATE_METHODS = new Set(['set_status', 'update_status', 'payment_complete']);
const isOrderStateCall = (call) => call.receiver === 'var' && ORDER_STATE_METHODS.has(String(call.name).toLowerCase());

/** Every state write and outbound request, order state call, and the first auth-like call, within HOPS of a callback. */
function inspectCallback(ctx, rel, target) {
  const effects = [];
  const guards = [];
  const orderWrites = [];
  const collect = (fact, { file }) => {
    const hidden = ctx.crossFile === false && file !== rel;
    const own = hidden ? [] : [...fact.stateWrites, ...fact.outboundRequests];
    for (const e of own) effects.push({ name: e.name, line: e.line, file });
    const orderCalls = hidden ? [] : fact.calls.filter(isOrderStateCall);
    for (const c of orderCalls) orderWrites.push({ name: c.name, line: c.line, file });
    const hasGuard = !hidden && fact.authChecks.length > 0;
    if (hasGuard) guards.push({ name: fact.authChecks[0].name, line: fact.authChecks[0].line, file });
    return false;
  };
  ctx.index.reaches(target, collect, { hops: HOPS });
  return { effects, guards, orderWrites };
}

// Task #6712: a record or session write (new post, user or table row, login cookie) is HIGH; options, meta,
// transients, mail and outbound requests stay MEDIUM. A name match only: update_post_meta( 'paid' ) stays MEDIUM.
const RECORD_WRITE = /^wp_(insert|update|delete)_(?!option|site_option)|^(wp_create_user|wp_set_auth_cookie|wp_set_current_user|wp_signon|insert|update|delete|replace)$/;
const severityOf = (effects, orderWrites) => (orderWrites.length > 0 || effects.some((e) => RECORD_WRITE.test(String(e.name).toLowerCase())) ? 'HIGH' : 'MEDIUM');
const isLogoutOnly = (effects) => effects.every((e) => String(e.name).toLowerCase() === 'wp_logout');
const where = (effect) => `${effect.name}() at ${effect.file}:${effect.line}`;
const verbList = (endpoint) => endpoint.methods.verbs.join(', ');
const routeName = (route) => route.route || 'a route';
const reportOnce = (seen, ctx, rule, line, hazard, extra) => {
  const key = `${rule}:${line}`;
  if (seen.has(key)) return;
  seen.add(key);
  ctx.report(rule, line, hazard, extra);
};

function crossFileOf(rel, endpoint, effect) {
  const target = endpoint.callback.target;
  const permission = endpoint.permission.target;
  return [effect.file, target && target.file, permission && permission.file].some((f) => Boolean(f) && f !== rel);
}

function checkWrite(ctx, rel, seen, route, endpoint) {
  const target = endpoint.callback.target;
  const isCandidate = Boolean(target) && hasWriteVerb(endpoint) && isPublic(endpoint);
  if (!isCandidate) return;
  const { effects, guards, orderWrites } = inspectCallback(ctx, rel, target);
  const isFlagged = effects.length > 0 && !isLogoutOnly(effects) && guards.length === 0;
  if (!isFlagged) return;
  const [effect] = effects;
  const hazard = `REST route ${routeName(route)} accepts ${verbList(endpoint)} with a public permission_callback (${endpoint.permission.kind}), and its callback ${target.id} reaches ${where(effect)} with no auth-like call found within ${HOPS} hops (a name match, not a proof). Check a capability, nonce or signature, or mark the route intentionally public with chemx-allow and a reason.`;
  reportOnce(seen, ctx, WRITE_ROUTE, endpoint.permission.line, hazard, {
    severity: severityOf(effects, orderWrites),
    crossFile: crossFileOf(rel, endpoint, effect),
    evidence: `callback ${target.id} at ${target.file}:${target.line}; ${where(effect)}`,
  });
}

function checkReadEffect(ctx, rel, seen, route, endpoint) {
  const target = endpoint.callback.target;
  const isCandidate = Boolean(target) && endpoint.methods.resolved && !hasWriteVerb(endpoint) && isPublic(endpoint);
  if (!isCandidate) return;
  const [effect] = inspectCallback(ctx, rel, target).effects;
  if (!effect) return;
  const hazard = `REST route ${routeName(route)} is public and accepts ${verbList(endpoint)} (no write verb), but its callback ${target.id} reaches ${where(effect)} within ${HOPS} hops. A read endpoint should not change state or call out; use a write verb with a permission check.`;
  reportOnce(seen, ctx, READ_EFFECT, endpoint.callback.line || endpoint.line, hazard, {
    crossFile: crossFileOf(rel, endpoint, effect),
    evidence: `callback ${target.id} at ${target.file}:${target.line}; ${where(effect)}`,
  });
}

function checkMissingPermission(ctx, seen, route, endpoint) {
  const isMissing = endpoint.permission.kind === 'missing';
  if (!isMissing) return;
  const hazard = `REST route ${routeName(route)} has an endpoint with no permission_callback. WordPress 5.5 and later logs a notice, and the endpoint is open to everyone; add one (for example '__return_true' for an intentionally public route).`;
  reportOnce(seen, ctx, NO_PERMISSION, endpoint.line, hazard, {});
}

function makePass(check, needsIndex) {
  return (ctx) => {
    const isReady = isWordPressFile(ctx) && (!needsIndex || Boolean(ctx.index));
    if (!isReady) return;
    const rel = indexPathOf(ctx);
    const seen = new Set();
    for (const route of resolveRestRoutes(ctx)) {
      for (const endpoint of route.endpoints) check(ctx, rel, seen, route, endpoint);
    }
  };
}

/** Pass entries. Silent without WordPress; the write and read rules are also silent without ctx.index. */
export const wpPublicWriteRoutePass = makePass(checkWrite, true);
export const wpReadSideEffectPass = makePass(checkReadEffect, true);
export const wpNoPermissionPass = makePass((ctx, rel, seen, route, endpoint) => checkMissingPermission(ctx, seen, route, endpoint), false);

/** The entries the language flip adds to PASSES. */
export const wpRouteRegistrations = [
  { name: 'wp-public-write-route', rules: [WRITE_ROUTE], isWordPress: true, run: wpPublicWriteRoutePass },
  { name: 'wp-rest-no-permission', rules: [NO_PERMISSION], isWordPress: true, run: wpNoPermissionPass },
  { name: 'wp-read-side-effect', rules: [READ_EFFECT], isWordPress: true, run: wpReadSideEffectPass },
  wpShadowedRouteRegistration,
  wpUnboundedRequestArrayRegistration,
];
