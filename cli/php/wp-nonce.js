// SECURITY_WP_MISSING_NONCE (design spec 4): a wp_ajax_* or admin_post_* handler that reaches a state
// write within 2 hops and no nonce check within 2 hops. A pass is (ctx) => void and reports only
// through ctx.report. Dark until the language flip registers .php.
import path from 'node:path';

const RULE = 'SECURITY_WP_MISSING_NONCE';
const HOPS = 2;
const HOOK_PREFIX = /^(?:wp_ajax_|admin_post_)/;

export const RULE_DEFAULTS = {
  // Weighted figures are in cli/php/wp-nonce.precision.spec.js. Held-out covers snapshot-backups and
  // wp-hummingbird only: five other held-out plugins exceed the project index cap and were not measured,
  // so the held-out figure rests on 3 hits (5 more known false-hit shapes stay silent).
  [RULE]: { defaultOn: true, corpus: '31/32', heldOut: '3/3', measured: '2026-10-24' },
};

// State writes the shared vocabulary (php-facts-vocab.js, read-only here) does not label. Name match on a plain function call.
const EXTRA_WRITE_FUNCTIONS = new Set([
  'activate_plugin', 'activate_plugins', 'deactivate_plugins', 'delete_plugins', 'switch_theme',
  'wp_trash_post', 'wp_untrash_post', 'wp_set_password',
]);

const hasNonce = (fact) => fact.nonceChecks.length > 0;
const isExtraWrite = (call) => call.receiver === 'func' && EXTRA_WRITE_FUNCTIONS.has(String(call.name).toLowerCase());
const firstWriteOf = (fact) => fact.stateWrites[0] || fact.calls.find(isExtraWrite);

/** The file's path as the project index names it: relative to the WordPress root when known. */
function indexPathOf(ctx) {
  const root = ctx.wp && ctx.wp.root;
  const isMeasurable = Boolean(root) && path.isAbsolute(ctx.filePath);
  return isMeasurable ? path.relative(root, ctx.filePath).split(path.sep).join('/') : ctx.relativePath;
}

const hookOf = (registration) => registration.hook || `${registration.hookPrefix}...`;
const isHandlerHook = (registration) => HOOK_PREFIX.test(registration.hook || registration.hookPrefix || '');

/** Every handler declaration in this file that an ajax or admin_post registration resolves into, grouped by declaration. */
function handlersIn(ctx, rel) {
  const handlers = new Map();
  for (const registration of ctx.index.registrationsFor(rel).filter(isHandlerHook)) {
    const isSkipped = registration.file !== rel && ctx.crossFile === false;
    const targets = isSkipped ? [] : ctx.index.resolveRegistration(registration).map((c) => c.target);
    for (const target of targets.filter((t) => Boolean(t) && t.file === rel)) {
      const entry = handlers.get(target.id) || { target, registrations: [] };
      entry.registrations.push(registration);
      handlers.set(target.id, entry);
    }
  }
  return [...handlers.values()];
}

/** The first state write reachable from the handler within HOPS, or null. */
function findWrite(index, target) {
  let write = null;
  const predicate = (fact, { file }) => {
    const first = firstWriteOf(fact);
    const isFirstWrite = Boolean(first) && !write;
    write = isFirstWrite ? { name: first.name, line: first.line, file } : write;
    return Boolean(first);
  };
  return index.reaches(target, predicate, { hops: HOPS }) ? write : null;
}

function evidenceFor(registrations, write) {
  const [first, ...rest] = registrations;
  const more = rest.length > 0 ? ` and ${rest.length} more` : '';
  return `registered at ${first.file}:${first.line} (${hookOf(first)})${more}; state write ${write.name}() at ${write.file}:${write.line}`;
}

function checkHandler(ctx, handler) {
  const { target, registrations } = handler;
  const write = findWrite(ctx.index, target);
  const isChecked = Boolean(write) && Boolean(ctx.index.reaches(target, hasNonce, { hops: HOPS }));
  const isMissing = Boolean(write) && !isChecked;
  if (!isMissing) return;
  const first = registrations[0];
  const hazard = `Handler ${target.id} is registered for ${hookOf(first)} at ${first.file}:${first.line} and reaches a state write with no nonce check within ${HOPS} hops (check_admin_referer, check_ajax_referer, wp_verify_nonce or a nonce-named call).`;
  const crossFile = registrations.some((r) => r.file !== target.file);
  ctx.report(RULE, target.line, hazard, { evidence: evidenceFor(registrations, write), crossFile });
}

/** Pass entry. Silent without ctx.index or WordPress; at most one finding per handler declaration. */
export function wpNoncePass(ctx) {
  const isReady = Boolean(ctx.index) && Boolean(ctx.wp) && ctx.wp.isWordPress === true;
  if (!isReady) return;
  for (const handler of handlersIn(ctx, indexPathOf(ctx))) checkHandler(ctx, handler);
}

/** The entry the language flip adds to PASSES. */
export const wpNonceRegistration = { name: 'wp-nonce', rules: [RULE], isWordPress: true, run: wpNoncePass };
