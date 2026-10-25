// SECURITY_WP_PUBLIC_REGISTRATION_ROUTE (task #6709): a public write REST route whose callback reaches a user-creating
// call (wp_create_user, wp_insert_user, register_new_user, wc_create_new_customer) within 2 hops, and no function on
// that path mentions the users_can_register option or a plugin registration setting. A captcha or nonce does not
// decide whether registration is open, so SECURITY_WP_PUBLIC_WRITE_ROUTE, which counts such a call as a guard, stays
// silent on these routes. A name and text match over the project index, not proof: a function that reads the setting
// through a differently named helper is reported, and the rule does not follow a setting read held in another file.
import fs from 'node:fs';
import path from 'node:path';
import { resolveRestRoutes, indexPathOf, PUBLIC_KINDS } from './wp-rest-endpoints.js';

const RULE = 'SECURITY_WP_PUBLIC_REGISTRATION_ROUTE';
const HOPS = 2;
const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH']);
const CREATE_CALLS = new Set(['wp_create_user', 'wp_insert_user', 'register_new_user', 'wc_create_new_customer']);
// The core option, or a plugin setting named for open registration.
const SETTING_TEXT = /users_can_register|(?:allow|enable|open|disable|registration)_?(?:user_)?registration|registration_(?:open|enabled|allowed|disabled|closed)|(?:allow|enable)_?(?:sign_?ups?|signups?)/i;

// A route named for registration. Routes that create a user as a side effect of signing in, an OAuth callback, a
// webhook or a checkout (request-code, magic link, discord token, stripe webhook) are not matched: they create
// accounts by design and measured 6 of 6 intentional on the first-party plugins (task #6709 comment).
const REGISTRATION_ROUTE = /regist|sign-?up|join|create[-_]?user|new[-_]?user|enrol/i;

// Figures are in cli/php/wp-registration.precision.spec.js and the task #6709 comment (each hit labelled by reading the
// callback). Corpus (674 files): 2 hits, 2 TP. Held-out: card vault a708d6a 1 TP, ae81b02 0 hits, own plugins outside the
// corpus 2 TP, third-party plugins 0 hits. Both figures rest on fewer than the 10 hits the bar names, so it ships off.
export const RULE_DEFAULTS = {
  [RULE]: { defaultOn: false, corpus: '2/2', heldOut: '3/3 (3 hits only)', measured: '2026-10-25' },
};

const isWordPressFile = (ctx) => Boolean(ctx.wp) && ctx.wp.isWordPress === true;
const hasWriteVerb = (endpoint) => endpoint.methods.verbs.some((v) => WRITE_VERBS.has(v));
const routeName = (route) => route.route || 'a route';

const readDisk = (root, file) => (root ? fs.readFileSync(path.join(root, file), 'utf8') : '');

/** The lines of an indexed file: the audited content for the audited file, else the file on disk. */
function textReader(ctx, rel) {
  const cache = new Map();
  const load = (file) => {
    const isAudited = file === rel && typeof ctx.content === 'string';
    return isAudited ? ctx.content : readDisk(ctx.wp.root, file);
  };
  return (file) => {
    cache.set(file, cache.get(file) ?? load(file).split('\n'));
    return cache.get(file);
  };
}

/** The first user-creating call and whether any function within HOPS names a registration setting. */
function inspect(ctx, rel, target) {
  const linesOf = textReader(ctx, rel);
  const found = { create: null, hasSetting: false };
  ctx.index.reaches(target, (fact, { file }) => {
    const isHidden = ctx.crossFile === false && file !== rel;
    const call = isHidden ? null : fact.calls.find((c) => CREATE_CALLS.has(String(c.name).toLowerCase()));
    const body = isHidden ? '' : linesOf(file).slice(Math.max(0, fact.line - 1), fact.endLine).join('\n');
    found.create = found.create ?? (call ? { name: call.name, line: call.line, file } : null);
    found.hasSetting = found.hasSetting || SETTING_TEXT.test(body);
    return false;
  }, { hops: HOPS });
  return found;
}

function check(ctx, rel, seen, route, endpoint) {
  const target = endpoint.callback.target;
  const isCandidate = Boolean(target) && hasWriteVerb(endpoint) && PUBLIC_KINDS.has(endpoint.permission.kind);
  if (!isCandidate) return;
  const { create, hasSetting } = inspect(ctx, rel, target);
  const isFlagged = Boolean(create) && !hasSetting && REGISTRATION_ROUTE.test(routeName(route));
  const line = endpoint.permission.line;
  const isNew = isFlagged && !seen.has(line);
  if (!isNew) return;
  seen.add(line);
  const hazard = `REST route ${routeName(route)} accepts ${endpoint.methods.verbs.join(', ')} with a public permission_callback, and its callback ${target.id} reaches ${create.name}() at ${create.file}:${create.line}, but no function within ${HOPS} hops mentions users_can_register or a registration setting (a text match, not a proof). Anyone can create an account while registration is closed; read the setting and refuse when it is off, or mark the route intentionally public with chemx-allow and a reason.`;
  ctx.report(RULE, line, hazard, { evidence: `callback ${target.id} at ${target.file}:${target.line}; ${create.name}() at ${create.file}:${create.line}` });
}

/** Pass entry. Silent without WordPress or without ctx.index. */
export function wpRegistrationPass(ctx) {
  const isReady = isWordPressFile(ctx) && Boolean(ctx.index);
  if (!isReady) return;
  const rel = indexPathOf(ctx);
  const seen = new Set();
  for (const route of resolveRestRoutes(ctx)) {
    for (const endpoint of route.endpoints) check(ctx, rel, seen, route, endpoint);
  }
}

/** The entry php-analyzer.js adds to the WordPress passes. */
export const wpRegistrationRegistration = { name: 'wp-registration', rules: [RULE], isWordPress: true, run: wpRegistrationPass };
