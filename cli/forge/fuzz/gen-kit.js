// Shared building blocks of the fuzz generators (#2596): a small expression grammar over the host's
// params (a, b, c, d) and the probe f, body forms that put an expression in a value, test or effect
// position, and side builders for each file kind. Every random decision goes through the choice stream
// (choices.js), and option 0 is always the simplest one, so a shrinker that zeroes choices simplifies.
export const PARAMS = 'a, b, c, d, f';
export const LEAVES = Object.freeze(['a', 'b', 'c', 'd', '0', '1', "''", "'x'", 'null', 'undefined', 'f(1)', 'f(2)', 'a.x', 'b.y', 'a.length', '`t`', 'NaN']);
const BINARY = Object.freeze(['+', '-', '*', '<', '<=', '>', '>=', '==', '===', '!=', '!==', '&&', '||', '??', '&', '|']);
const UNARY = Object.freeze(['!', '-', '+', 'typeof ', 'void ', '~']);

const COMBINERS = [
  (g, e) => `(${e()} ${g.pick(BINARY)} ${e()})`,
  (g, e) => `${g.pick(UNARY)}${e()}`,
  (g, e) => `(${e()} ? ${e()} : ${e()})`,
  (g, e) => `f(${e()})`,
  (g, e) => `${e()}?.x`,
  (g, e) => `[${e()}, ${e()}]`,
  (g, e) => `({ x: ${e()} })`,
  (g, e) => `\`<\${${e()}}>\``,
  (g, e) => `(${e()}, ${e()})`,
  (g, e) => `Boolean(${e()})`
];

/** A random expression: a leaf (choice 0) or a combinator over smaller expressions. */
export const expr = (g, depth = 2, leaves = LEAVES) => {
  const isLeaf = depth <= 0 || g.int(3) === 0;
  if (isLeaf) return g.pick(leaves);
  return g.pick(COMBINERS)(g, () => expr(g, depth - 1, leaves));
};

const LITERAL = /\b\d+\b|''|'x'|`t`|\bnull\b|\bNaN\b/g;

/**
 * True when two expressions differ only in literals. A rewrite that swaps them is then a merge L2 makes
 * by design (it erases literals), so the pair must be evaluated on an L1 merge only (#4560).
 */
export const differsOnlyInLiterals = (x, y) => x.replace(LITERAL, 'L') === y.replace(LITERAL, 'L');

/** Body forms: the expression in value, test, loop-test, alias and effect position. */
export const BODY_FORMS = Object.freeze([
  (e) => `return ${e};`,
  (e) => `if (${e}) { return 1; } return 2;`,
  (e) => `return ${e} ? 'y' : 'n';`,
  (e) => `const v = ${e}; return [v, typeof v];`,
  (e) => `while (${e}) { f(9); break; } return 0;`,
  (e) => `f(${e}); return 0;`
]);

export const fnSource = (body, { params = PARAMS, before = '', after = '', prefix = 'export ', head = 'function' } = {}) =>
  `${before}${prefix}${head} host(${params}) { ${body} }${after}`;

export const moduleSide = (code, entry = 'src/p/a.ts', extraFiles = {}) => ({ files: { ...extraFiles, [entry]: code }, entry, mode: 'module' });
export const scriptSide = (code, entry = 'src/p/a.cjs', extraFiles = {}) => ({ files: { ...extraFiles, [entry]: code }, entry, mode: 'script' });
export const templateSide = (code, entry) => ({ files: { [entry]: code }, entry, mode: 'module' });

/** A pair of host functions in module files that differ only in their bodies. */
export const bodyPair = (leftBody, rightBody, options = {}) => {
  const { abstracts = false, entry = 'src/p/a.ts', invoke, ...source } = options;
  const left = { ...moduleSide(fnSource(leftBody, source), entry), invoke };
  const right = { ...moduleSide(fnSource(rightBody, source), entry), invoke };
  return { left, right, abstracts };
};

/** A pair of whole sources (module or script files, with optional extra files per side). */
export const sourcePair = (leftCode, rightCode, options = {}) => {
  const { abstracts = false, entry = 'src/p/a.ts', rightEntry = entry, files = {}, rightFiles = files, invoke, mode = 'module', rightMode = mode, params, unit } = options;
  const build = (code, path, extra, kind) => ({ ...(kind === 'script' ? scriptSide : moduleSide)(code, path, extra), invoke });
  return { left: build(leftCode, entry, files, mode), right: build(rightCode, rightEntry, rightFiles, rightMode), abstracts, params, unit };
};

/** Picks one rewrite ([name, make(g) -> pair]) and builds its pair, named by the rewrite. */
export const fromRewrites = (rewrites) => (g) => {
  const [name, make] = g.pick(rewrites);
  return { rewrite: name, ...make(g) };
};

