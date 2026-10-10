// Fuzz generators for scope and binding constructs (#2596): array holes, TDZ, var hoisting and
// redeclaration, switch scope and fallthrough, destructuring with defaults, and binder renames (the
// abstraction L1 is built on: a consistent rename is sound unless a name is read at runtime, by a
// direct eval or a `with`, or the rename captures or shadows another binding).
import { bodyPair, expr, fromRewrites, sourcePair, fnSource } from './gen-kit.js';
import { formPair } from './gen-logic.js';

const e = (g) => expr(g, 2);
const objectish = (g) => g.pick(['a', 'b', '({ x: f(1) })', '({ x: undefined, y: 2 })', 'c', '[f(1), f(2)]']);

const HOLES = [
  ['elision-middle', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `[${x}, , ${y}]`, `[${x}, ${y}]`); }],
  ['elision-leading', (g) => { const x = e(g); return formPair(g, `[, ${x}]`, `[${x}]`); }],
  ['elision-trailing', (g) => { const x = e(g); return formPair(g, `[${x}, ,]`, `[${x},]`); }],
  ['trailing-comma', (g) => { const x = e(g); return formPair(g, `[${x},]`, `[${x}]`); }],
  ['pattern-elision', (g) => { const x = objectish(g); return bodyPair(`const [, v] = ${x} ?? []; return v;`, `const [v] = ${x} ?? []; return v;`); }],
  ['pattern-elision-middle', (g) => { const x = objectish(g); return bodyPair(`const [v, , w] = ${x} ?? []; return [v, w];`, `const [v, w] = ${x} ?? []; return [v, w];`); }],
  ['pattern-elision-rest', (g) => { const x = objectish(g); return bodyPair(`const [, ...r] = ${x} ?? []; return r;`, `const [...r] = ${x} ?? []; return r;`); }],
  ['assign-elision', (g) => { const x = objectish(g); return bodyPair(`let v; [, v] = ${x} ?? []; return v;`, `let v; [v] = ${x} ?? []; return v;`); }],
  ['spread-elision', (g) => { const x = e(g); return formPair(g, `[...[${x}, , 1]]`, `[...[${x}, 1]]`); }]
];

const TDZ = [
  ['typeof-later-let', (g) => { const x = e(g); return bodyPair(`const r = typeof later; let later = ${x}; return r;`, `const r = typeof later; return r;`); }],
  ['closure-before-init', (g) => { const x = e(g); return bodyPair(`const read = () => later; const r = read(); let later = ${x}; return r;`, `let later = ${x}; const read = () => later; const r = read(); return r;`); }],
  ['self-reference', (g) => bodyPair(`let v = typeof v; return v;`, `var v = typeof v; return v;`)],
  ['case-let-jump', (g) => { const x = e(g); return bodyPair(`switch (${x}) { case 1: let v = 1; return v; default: return typeof v; }`, `switch (${x}) { case 1: { let v = 1; return v; } default: return typeof v; }`); }],
  ['class-heritage', (g) => bodyPair('class K extends (typeof K === "function" ? Object : Object) {} return typeof K;', 'class K extends Object {} return typeof K;')],
  ['param-default-order', (g) => { const x = e(g); return sourcePair(fnSource('return [p, q];', { params: `a, b, c, d, f, p = q, q = ${x}` }), fnSource('return [p, q];', { params: `a, b, c, d, f, q = ${x}, p = q` })); }],
  ['let-to-var', (g) => { const x = e(g); return bodyPair(`if (${x}) { return typeof v; } let v = 1; return v;`, `if (${x}) { return typeof v; } var v = 1; return v;`); }],
  ['outer-let-later', (g) => { const x = e(g); return sourcePair(`export function host(a, b, c, d, f) { return [${x}, typeof cfg]; }\nlet cfg = 1;`, `export function host(a, b, c, d, f) { return [${x}, typeof cfg]; }`); }]
];

const VARS = [
  ['redeclare-var', (g) => { const x = e(g); return bodyPair(`var v = ${x}; var v; return v;`, `var v = ${x}; return v;`); }],
  ['split-var-init', (g) => { const x = e(g); return bodyPair(`var v; v = ${x}; return v;`, `var v = ${x}; return v;`); }],
  ['redeclare-param', (g) => { const x = e(g); return bodyPair(`var a; return [a, ${x}];`, `return [a, ${x}];`); }],
  ['redeclare-param-undefined', (g) => { const x = e(g); return bodyPair(`var a = undefined; return [a, ${x}];`, `var a; return [a, ${x}];`); }],
  ['block-var', (g) => { const x = e(g); return bodyPair(`{ var v = ${x}; } return v;`, `var v = ${x}; return v;`); }],
  ['hoisted-function', (g) => { const x = e(g); return bodyPair(`return g(); function g() { return ${x}; }`, `return g(); var g = function () { return ${x}; };`); }],
  ['loop-var-closure', (g) => bodyPair('const fs = []; for (var i = 0; i < 2; i++) { fs.push(() => i); } return fs.map((h) => h());', 'const fs = []; for (let i = 0; i < 2; i++) { fs.push(() => i); } return fs.map((h) => h());')],
  ['var-in-catch', (g) => { const x = e(g); return bodyPair(`try { throw ${x}; } catch (v) { var v = 1; } return v;`, `try { throw ${x}; } catch (w) { var v = 1; } return v;`); }]
];

const caseTest = (g) => g.pick(['0', '1', "'x'", 'a', 'f(1)', 'b']);

const SWITCHES = [
  ['drop-break', (g) => { const [d, t1, t2] = [e(g), caseTest(g), caseTest(g)]; return bodyPair(`switch (${d}) { case ${t1}: f(1); break; case ${t2}: f(2); } return 0;`, `switch (${d}) { case ${t1}: f(1); case ${t2}: f(2); } return 0;`); }],
  ['swap-cases', (g) => { const [d, t1, t2] = [e(g), caseTest(g), caseTest(g)]; return bodyPair(`switch (${d}) { case ${t1}: return 1; case ${t2}: return 2; } return 0;`, `switch (${d}) { case ${t2}: return 2; case ${t1}: return 1; } return 0;`, { abstracts: true }); }],
  ['move-default', (g) => { const [d, t1] = [e(g), caseTest(g)]; return bodyPair(`switch (${d}) { default: f(0); case ${t1}: f(1); } return 0;`, `switch (${d}) { case ${t1}: f(1); default: f(0); } return 0;`); }],
  ['case-block', (g) => { const [d, t1] = [e(g), caseTest(g)]; return bodyPair(`switch (${d}) { case ${t1}: { f(1); } }  return 0;`, `switch (${d}) { case ${t1}: f(1); } return 0;`); }],
  ['case-literal-type', (g) => { const d = e(g); return bodyPair(`switch (${d}) { case 1: return 'one'; } return 0;`, `switch (${d}) { case '1': return 'one'; } return 0;`, { abstracts: true }); }],
  ['boolean-discriminant', (g) => { const d = e(g); return bodyPair(`switch (Boolean(${d})) { case true: return 1; } return 0;`, `switch (${d}) { case true: return 1; } return 0;`); }],
  ['empty-case-merge', (g) => { const [d, t1, t2] = [e(g), caseTest(g), caseTest(g)]; return bodyPair(`switch (${d}) { case ${t1}: case ${t2}: return 1; } return 0;`, `switch (${d}) { case ${t2}: case ${t1}: return 1; } return 0;`, { abstracts: true }); }]
];

const DESTRUCTURING = [
  ['shorthand-pattern', (g) => { const x = objectish(g); return bodyPair(`const { x } = ${x} ?? {}; return x;`, `const { x: x } = ${x} ?? {}; return x;`); }],
  ['shorthand-literal', (g) => { const x = e(g); return bodyPair(`const x = ${x}; return { x };`, `const x = ${x}; return { x: x };`); }],
  ['default-vs-nullish', (g) => { const [x, y] = [objectish(g), e(g)]; return bodyPair(`const { x = ${y} } = ${x} ?? {}; return x;`, `const x = (${x} ?? {}).x ?? ${y}; return x;`); }],
  ['default-order', (g) => { const x = objectish(g); return bodyPair(`const { x = f(1), y = f(2) } = ${x} ?? {}; return [x, y];`, `const { y = f(2), x = f(1) } = ${x} ?? {}; return [x, y];`, { abstracts: true }); }],
  ['array-default', (g) => { const [x, y] = [objectish(g), e(g)]; return bodyPair(`const [v = ${y}] = ${x} ?? []; return v;`, `const v = (${x} ?? [])[0] ?? ${y}; return v;`); }],
  ['rest-drop', (g) => { const x = objectish(g); return bodyPair(`const { x, ...r } = ${x} ?? {}; return r;`, `const { ...r } = ${x} ?? {}; return r;`); }],
  ['computed-key', (g) => { const [x, k] = [objectish(g), e(g)]; return bodyPair(`const { [${k}]: v } = ${x} ?? {}; return v;`, `const v = (${x} ?? {})[${k}]; return v;`); }],
  ['assign-default', (g) => { const [x, y] = [objectish(g), e(g)]; return bodyPair(`let v; ({ x: v = ${y} } = ${x} ?? {}); return v;`, `let v; ({ x: v } = ${x} ?? {}); v = v ?? ${y}; return v;`); }],
  ['nested-default', (g) => { const x = objectish(g); return bodyPair(`const { x: { y } = {} } = ${x} ?? {}; return y;`, `const { x: { y } } = ${x} ?? {}; return y;`); }],
  ['default-rename', (g) => { const [x, y] = [objectish(g), e(g)]; return bodyPair(`const { x: p = ${y} } = ${x} ?? {}; return p;`, `const { x: q = ${y} } = ${x} ?? {}; return q;`); }]
];

const NAME_BODIES = [
  (n, x) => `const ${n.v} = ${x}; return [${n.v}, typeof ${n.v}];`,
  (n, x) => `let ${n.v} = ${x}; { let ${n.w} = ${n.v}; ${n.v} = 1; return [${n.v}, ${n.w}]; }`,
  (n, x) => `function ${n.v}() { return ${x}; } return ${n.v}();`,
  (n, x) => `try { throw ${x}; } catch (${n.v}) { return ${n.v}; }`,
  (n, x) => `const ${n.v} = ${x}; return eval('${n.v}');`,
  (n, x) => `const ${n.v} = ${x}; return eval('typeof v');`,
  (n, x) => `const ${n.v} = ${x}; return [(0, eval)('typeof ${n.v}'), ${n.v}];`,
  (n, x) => `for (const ${n.v} of [${x}]) { return ${n.v}; } return 0;`,
  (n, x) => `const ${n.v} = ${x}; return { ${n.v} };`,
  (n, x) => `class ${n.v} { m() { return ${x}; } } return new ${n.v}().m();`,
  (n, x) => `const ${n.v} = ${x}; return [arguments.length, ${n.v}];`,
  (n, x) => `const ${n.v} = ${x}; if (Boolean(${n.v})) { return 1; } return 2;`,
  (n, x) => `const ${n.v} = ${x}; return [${n.v}, a, f];`,
  (n, x) => `const ${n.v} = ${x}; return new Function('return typeof ${n.v}')();`
];
const RENAMES = ['w', 'a', 'f', 'undefined', 'Boolean', 'Object', 'arguments', 'k2', 'NaN'];

const renamePair = (g) => {
  const body = g.pick(NAME_BODIES);
  const x = e(g);
  const target = g.pick(RENAMES);
  const isShadowedInner = g.chance(2);
  const left = body({ v: 'v', w: 'w' }, x);
  const right = body(isShadowedInner ? { v: 'v', w: target } : { v: target, w: 'w' }, x);
  // A rename also renames a shorthand key or a name inside an eval string: L2 erases both by design.
  return bodyPair(left, right, { abstracts: true });
};

const SCRIPT_NAME_BODIES = [
  (n, x) => `var o = { ${n.v}: 1 }; with (o) { return [${n.v}, ${x}]; }`,
  (n, x) => `var ${n.v} = ${x}; with ({ v: 2 }) { return ${n.v}; }`,
  (n, x) => `var ${n.v} = ${x}; eval('var v = 3'); return ${n.v};`
];

const scriptRenamePair = (g) => {
  const body = g.pick(SCRIPT_NAME_BODIES);
  const x = e(g);
  const code = (n) => `function host(a, b, c, d, f) { ${body(n, x)} }\nmodule.exports = { host };`;
  return sourcePair(code({ v: 'v' }), code({ v: g.pick(['w', 'a', 'o']) }), { mode: 'script', entry: 'src/p/a.cjs', invoke: 'mod.host(...args)', abstracts: true });
};

const capturePair = (g) => {
  const x = e(g);
  const use = g.pick([(n) => `return [${n}, ${x}];`, (n) => `return typeof ${n};`, (n) => `${n} = ${x}; return ${n};`]);
  const name = g.pick(['cfg2', 'JSON', 'a', 'host']);
  const code = (n) => `let ${n} = 1;\nexport function host(a, b, c, d, f) { ${use(n)} }`;
  return sourcePair(code('cfg'), code(name), { abstracts: true });
};

const NAMES = [
  ['rename-local', renamePair],
  ['rename-in-script', scriptRenamePair],
  ['rename-capture', capturePair]
];

export const holesClass = fromRewrites(HOLES);
export const tdzClass = fromRewrites(TDZ);
export const varClass = fromRewrites(VARS);
export const switchClass = fromRewrites(SWITCHES);
export const destructuringClass = fromRewrites(DESTRUCTURING);
export const namesClass = fromRewrites(NAMES);
