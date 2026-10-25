// SECURITY_WP_SHADOWED_ROUTE (task #6711): a literal REST route registered after a regex route in the same file,
// same namespace, with a shared verb, where the regex matches the literal path in full. WordPress tries routes in
// registration order and the first match with a handler for the verb wins, so the later route never runs.
// Same-file only: a route registered in another file or built from a non-literal string is not compared.
import { resolveRestRoutes } from './wp-rest-endpoints.js';

const RULE = 'SECURITY_WP_SHADOWED_ROUTE';
const REGEX_CHARS = /[()[\]{}*+?\\|^$]/;

// Figures: cli/php/wp-route-shadow.precision.spec.js.
export const RULE_DEFAULTS = {
  // Corpus (674 files, 101 with routes): 0 hits. Held-out: card vault a708d6a 1 hit, true (POST /catalog/cards/prices
  // behind the EDITABLE /catalog/cards/(?P<id>...) route); card vault ae81b02 0 hits; 23 third-party plugins and own plugins
  // outside the corpus 0 hits. One hit is far under the 10 the bar names, so the rule ships default-off.
  [RULE]: { defaultOn: false, corpus: '0 hits', heldOut: '1/1', measured: '2026-10-25' },
};

const isLiteral = (route) => typeof route === 'string' && route.length > 0 && !REGEX_CHARS.test(route);
const isPattern = (route) => typeof route === 'string' && /\(\?P?<\w+>/.test(route);

/** WordPress anchors the route as @^route$@i; the PCRE named group (?P<n> is (?<n> in JavaScript. */
function compile(route) {
  try {
    return new RegExp(`^${route.replace(/\(\?P</g, '(?<')}$`, 'i');
  } catch {
    return null;
  }
}

const verbsOf = (route) => route.endpoints.filter((e) => e.methods.resolved).flatMap((e) => e.methods.verbs);
const sharedVerb = (a, b) => {
  const later = new Set(verbsOf(b));
  return verbsOf(a).find((v) => later.has(v)) || null;
};
const normal = (route) => (route.startsWith('/') ? route : `/${route}`);

/** One literal namespace, or one variable (same name, same scope) that both calls pass. */
function sharesNamespace(a, b) {
  const isLiteralMatch = Boolean(a.namespace) && a.namespace === b.namespace;
  const isVariableMatch = Boolean(a.namespaceVariable) && Boolean(b.namespaceVariable) && a.namespaceVariable.name === b.namespaceVariable.name && a.namespaceVariable.scope === b.namespaceVariable.scope;
  return isLiteralMatch || isVariableMatch;
}

function shadowOf(earlier, later) {
  const sameSpace = sharesNamespace(earlier, later);
  const isCandidate = sameSpace && isPattern(earlier.route) && isLiteral(later.route);
  if (!isCandidate) return null;
  const pattern = compile(normal(earlier.route));
  const verb = sharedVerb(earlier, later);
  const isShadowed = Boolean(pattern) && Boolean(verb) && pattern.test(normal(later.route));
  return isShadowed ? verb : null;
}

export function wpShadowedRoutePass(ctx) {
  const isReady = Boolean(ctx.wp) && ctx.wp.isWordPress === true;
  if (!isReady) return;
  const routes = resolveRestRoutes(ctx);
  routes.forEach((later, i) => {
    for (const earlier of routes.slice(0, i)) {
      const verb = shadowOf(earlier, later);
      if (!verb) continue;
      const hazard = `REST route ${later.route} (${verb}) is registered after ${earlier.route} at line ${earlier.line}, whose pattern matches the same path for the same verb, so WordPress dispatches ${verb} requests to the earlier route and this one does not run. Register the literal route first (a name match on the route strings in this file, not a proof: other files are not compared).`;
      ctx.report(RULE, later.line, hazard, { evidence: `${earlier.route} (line ${earlier.line}) matches ${later.route}` });
      return;
    }
  });
}

export const wpShadowedRouteRegistration = { name: 'wp-shadowed-route', rules: [RULE], isWordPress: true, run: wpShadowedRoutePass };
