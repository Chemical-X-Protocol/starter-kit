// WordPress REST route rules (design spec 4): SECURITY_WP_PUBLIC_WRITE_ROUTE, SECURITY_WP_REST_NO_PERMISSION_CALLBACK
// and SECURITY_WP_PUBLIC_READ_SIDE_EFFECT. A pass is (ctx) => void and reports only through ctx.report. The
// effect and guard checks are name matches over the project index within 2 hops, not proof of behavior.
// Dark until the language flip registers .php.
import { resolveRestRoutes, indexPathOf, PUBLIC_KINDS } from './wp-rest-endpoints.js';

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
  [WRITE_ROUTE]: { defaultOn: true, corpus: '22/25 directive, 14/25 real holes', heldOut: '1/1', measured: '2026-10-25' },
  [NO_PERMISSION]: { defaultOn: true, corpus: '0 hits of 570 endpoints', heldOut: '0 hits on 281 endpoints (akismet, WooCommerce controllers and API)', measured: '2026-10-24' },
  [READ_EFFECT]: { defaultOn: false, corpus: '5/8', heldOut: 'not labelled (5 hits unlabelled: card vault 4, WooCommerce 1)', measured: '2026-10-24' },
};

const isWordPressFile = (ctx) => Boolean(ctx.wp) && ctx.wp.isWordPress === true;
const hasWriteVerb = (endpoint) => endpoint.methods.verbs.some((v) => WRITE_VERBS.has(v));
const isPublic = (endpoint) => PUBLIC_KINDS.has(endpoint.permission.kind);

/** Every state write and outbound request, and the first auth-like call, within HOPS of a callback. */
function inspectCallback(ctx, rel, target) {
  const effects = [];
  const guards = [];
  const collect = (fact, { file }) => {
    const hidden = ctx.crossFile === false && file !== rel;
    const own = hidden ? [] : [...fact.stateWrites, ...fact.outboundRequests];
    for (const e of own) effects.push({ name: e.name, line: e.line, file });
    const hasGuard = !hidden && fact.authChecks.length > 0;
    if (hasGuard) guards.push({ name: fact.authChecks[0].name, line: fact.authChecks[0].line, file });
    return false;
  };
  ctx.index.reaches(target, collect, { hops: HOPS });
  return { effects, guards };
}

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
  const { effects, guards } = inspectCallback(ctx, rel, target);
  const isFlagged = effects.length > 0 && !isLogoutOnly(effects) && guards.length === 0;
  if (!isFlagged) return;
  const [effect] = effects;
  const hazard = `REST route ${routeName(route)} accepts ${verbList(endpoint)} with a public permission_callback (${endpoint.permission.kind}), and its callback ${target.id} reaches ${where(effect)} with no auth-like call found within ${HOPS} hops (a name match, not a proof). Check a capability, nonce or signature, or mark the route intentionally public with chemx-allow and a reason.`;
  reportOnce(seen, ctx, WRITE_ROUTE, endpoint.permission.line, hazard, {
    severity: 'MEDIUM',
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
];
