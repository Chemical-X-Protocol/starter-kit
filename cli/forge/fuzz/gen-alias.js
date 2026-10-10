// Fuzz generator for single-use const alias inlining (#2596), the opt-in pass of canon-inline.js
// (CHEMX_FORGE_INLINE=1): `const k = I; S(k)` against `S(I)`. Initializers cover reads that can throw
// (members, TDZ bindings, undeclared globals), implicit calls, `this` and eval; slots cover first and
// later evaluation positions, guards, callee and tag positions, typeof and delete, patterns, switch,
// try, loops, closures, class fields and shorthand keys. With inlining off the pair never merges, so
// in the default mode this class only confirms the alias stays.
import { bodyPair, expr, fromRewrites } from './gen-kit.js';

const INITS = ['a', 'a.x', 'f(1)', 'b.y', 'later', 'undeclared', 'typeof a', 'a === b', '!a', '[a]', 'a + 1', 'NaN', "'s'", 'a?.x', 'arguments[0]', 'this', 'f', 'eval', 'a.x.y', '(a, b)', 'later.x', 'c', 'await0'];

const SLOTS = [
  (k) => `return ${k};`,
  (k, x) => `return [${x}, ${k}];`,
  (k, x) => `return ${x} && ${k};`,
  (k, x) => `return ${x} ?? ${k};`,
  (k, x) => `return ${x} ? ${k} : 0;`,
  (k) => `if (${k}) { return 1; } return 2;`,
  (k) => `return typeof ${k};`,
  (k, x) => `return f(${x}, ${k});`,
  (k, x) => `return ${k}(${x});`,
  (k, x) => `return ${k}?.(${x});`,
  (k) => `return new ${k}();`,
  (k) => `return ${k}\`t\`;`,
  (k, x) => `return { [${x}]: ${k} };`,
  (k, x) => `return \`\${${x}}\${${k}}\`;`,
  (k, x) => `const { z = ${k} } = ${x} ?? {}; return z;`,
  (k, x) => `switch (${x}) { case ${k}: return 1; default: return 2; }`,
  (k) => `try { return ${k}; } catch { return 'c'; }`,
  (k, x) => `return ${x}?.[${k}];`,
  (k) => `for (const v of [1]) { return ${k}; } return 0;`,
  (k) => `return (() => ${k})();`,
  (k) => `return [a = 1, ${k}];`,
  (k) => `return delete ${k}.x;`,
  (k, x) => `${k}.x = ${x}; return a;`,
  (k, x) => `return [${k}, ...(${x} ?? [])];`,
  (k, x) => `return ${x} + ${k};`,
  (k) => `return { k: ${k} };`,
  (k, x) => `let t = ${x}, u = ${k}; return u;`,
  (k) => `return class { static z = ${k}; }.z;`,
  (k) => `return [eval('typeof k'), ${k}];`,
  (k) => `return ${k}.call(b);`,
  (k) => `return [${k}] = [9];`,
  (k) => `return ${k} = 2;`,
  (k) => `return ${k}++;`,
  (k, x) => `if (${x}) { return ${k}; } return 0;`,
  (k) => `return { m() { return ${k}; } }.m();`,
  (k, x) => `return (${x}, ${k});`
];

const initText = (init) => (init === 'await0' ? 'f(0)' : init);

const aliasPair = (g) => {
  const init = initText(g.pick(INITS));
  const slot = g.pick(SLOTS);
  const x = expr(g, 1);
  const tail = init.includes('later') ? ' let later = { x: 1 };' : '';
  const gap = g.chance(5) ? ' f(3);' : '';
  return bodyPair(`const k = ${init};${gap} ${slot('k', x)}${tail}`, `${gap} ${slot(`(${init})`, x)}${tail}`);
};

export const aliasClass = fromRewrites([['alias-inline', aliasPair]]);
