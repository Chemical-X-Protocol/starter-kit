// Fuzz generators for control flow and function kinds (#2596): try/finally, generators and async
// code, arrow vs function bodies (the expression-body rewrite of canon-nodes.js), bare vs braced
// statement bodies (the block rewrite), and strict vs sloppy code (the sloppy mark of units.js).
import { bodyPair, differsOnlyInLiterals, expr, fromRewrites, sourcePair } from './gen-kit.js';

const e = (g) => expr(g, 2);
const SCRIPT = Object.freeze({ mode: 'script', entry: 'src/p/a.cjs', invoke: '(mod.host ?? mod)(...args)' });

const TRIES = [
  ['finally-vs-before', (g) => { const x = e(g); return bodyPair(`try { return ${x}; } finally { f(1); }`, `f(1); return ${x};`); }],
  ['finally-override', (g) => { const [x, y] = [e(g), e(g)]; return bodyPair(`try { return ${x}; } finally { return ${y}; }`, `try { return ${y}; } finally { return ${x}; }`, { abstracts: differsOnlyInLiterals(x, y) }); }],
  ['optional-catch-binding', (g) => { const x = e(g); return bodyPair(`try { return ${x}; } catch (err) { return 'c'; }`, `try { return ${x}; } catch { return 'c'; }`); }],
  ['catch-rename', (g) => { const x = e(g); return bodyPair(`try { throw ${x}; } catch (err) { return err; }`, `try { throw ${x}; } catch (e2) { return e2; }`); }],
  ['try-unwrap', (g) => { const x = e(g); return bodyPair(`try { return ${x}; } catch { return 'c'; }`, `return ${x};`); }],
  ['finally-break', (g) => { const x = e(g); return bodyPair(`for (;;) { try { return ${x}; } finally { break; } } return 'broke';`, `for (;;) { try { return ${x}; } finally { f(1); } } return 'broke';`); }],
  ['catch-destructure', (g) => { const x = e(g); return bodyPair(`try { throw ${x}; } catch ({ x }) { return x; }`, `try { throw ${x}; } catch (err) { return err.x; }`); }]
];

const ASYNC = [
  ['await-vs-plain', (g) => { const x = e(g); return sourcePair(`export async function host(a, b, c, d, f) { const v = await ${x}; f(1); return v; }`, `export async function host(a, b, c, d, f) { const v = ${x}; f(1); return v; }`); }],
  ['return-await-in-try', (g) => sourcePair("export async function host(a, b, c, d, f) { try { return await Promise.reject(a); } catch { return 'caught'; } }", "export async function host(a, b, c, d, f) { try { return Promise.reject(a); } catch { return 'caught'; } }")],
  ['yield-vs-yield-star', (g) => { const x = e(g); return sourcePair(`export function* host(a, b, c, d, f) { yield ${x}; }`, `export function* host(a, b, c, d, f) { yield* [${x}]; }`); }],
  ['yield-star-vs-loop', (g) => sourcePair('export function* host(a, b, c, d, f) { return yield* (a ?? []); }', 'export function* host(a, b, c, d, f) { for (const v of (a ?? [])) { yield v; } return undefined; }')],
  ['async-arrow-body', (g) => { const x = e(g); return sourcePair(`export const host = async (a, b, c, d, f) => ${x};`, `export const host = async (a, b, c, d, f) => { return ${x}; };`); }],
  ['for-await', (g) => sourcePair('export async function host(a, b, c, d, f) { const out = []; for await (const v of (a ?? [])) { out.push(v); } return out; }', 'export async function host(a, b, c, d, f) { const out = []; for (const v of (a ?? [])) { out.push(v); } return out; }')],
  ['generator-method-kind', (g) => { const x = e(g); return bodyPair(`const o = { *m() { yield ${x}; } }; return [...o.m()];`, `const o = { m() { return [${x}]; } }; return [...o.m()];`); }],
  ['async-generator', (g) => { const x = e(g); return sourcePair(`export async function* host(a, b, c, d, f) { yield ${x}; }`, `export function* host(a, b, c, d, f) { yield ${x}; }`); }]
];

const FUNCTIONS = [
  ['arrow-expression-body', (g) => { const x = e(g); return bodyPair(`const g = () => ${x}; return g();`, `const g = () => { return ${x}; }; return g();`); }],
  ['arrow-statement-body', (g) => { const x = e(g); return bodyPair(`const g = () => ${x}; return g();`, `const g = () => { ${x}; }; return g();`); }],
  ['arrow-object-body', (g) => { const x = e(g); return bodyPair(`const g = () => ({ x: ${x} }); return g();`, `const g = () => { x: ${x} }; return g();`); }],
  ['arrow-sequence-body', (g) => { const [x, y] = [e(g), e(g)]; return bodyPair(`const g = () => (${x}, ${y}); return g();`, `const g = () => { return ${x}, ${y}; }; return g();`); }],
  ['arrow-vs-function-this', (g) => bodyPair('const g = () => this; return g.call(b);', 'const g = function () { return this; }; return g.call(b);')],
  ['arrow-vs-function-arguments', (g) => bodyPair('const g = () => arguments.length; return g(1, 2, 3);', 'const g = function () { return arguments.length; }; return g(1, 2, 3);')],
  ['host-arrow-body', (g) => { const x = e(g); return sourcePair(`export const host = (a, b, c, d, f) => ${x};`, `export const host = (a, b, c, d, f) => { return ${x}; };`); }],
  ['host-arrow-vs-function', (g) => { const x = e(g); return sourcePair(`export const host = (a, b, c, d, f) => { return [${x}, typeof this]; };`, `export const host = function (a, b, c, d, f) { return [${x}, typeof this]; };`); }],
  ['default-vs-nullish-param', (g) => { const x = e(g); return sourcePair(`export function host(a, b, c, d, f, p = ${x}) { return p; }`, `export function host(a, b, c, d, f, p) { p = p ?? ${x}; return p; }`); }]
];

const BLOCKS = [
  ['if-braces', (g) => { const x = e(g); return bodyPair(`if (${x}) return 1; return 2;`, `if (${x}) { return 1; } return 2;`); }],
  ['else-braces', (g) => { const x = e(g); return bodyPair(`if (${x}) f(1); else f(2); return 0;`, `if (${x}) { f(1); } else { f(2); } return 0;`); }],
  ['dangling-else', (g) => { const [x, y] = [e(g), e(g)]; return bodyPair(`if (${x}) if (${y}) f(1); else f(2); return 0;`, `if (${x}) { if (${y}) f(1); } else f(2); return 0;`); }],
  ['else-if-braces', (g) => { const [x, y] = [e(g), e(g)]; return bodyPair(`if (${x}) f(1); else if (${y}) f(2); return 0;`, `if (${x}) f(1); else { if (${y}) f(2); } return 0;`); }],
  ['loop-braces', (g) => bodyPair('const fs = []; for (let i = 0; i < 2; i++) fs.push(() => i); return fs.map((h) => h());', 'const fs = []; for (let i = 0; i < 2; i++) { fs.push(() => i); } return fs.map((h) => h());')],
  ['while-braces', (g) => { const x = e(g); return bodyPair(`while (${x}) break; return 0;`, `while (${x}) { break; } return 0;`); }],
  ['var-in-bare-if', (g) => { const x = e(g); return bodyPair(`if (${x}) var v = 1; return v;`, `if (${x}) { var v = 1; } return v;`); }],
  ['labeled-block', (g) => { const x = e(g); return bodyPair(`out: { if (${x}) break out; f(1); } return 0;`, `out: if (${x}) { } else { f(1); } return 0;`); }],
  ['sloppy-function-in-if', (g) => { const x = e(g); return sourcePair(`function host(a, b, c, d, f) { if (${x}) function g() { return 1; } return typeof g; }\nmodule.exports = host;`, `function host(a, b, c, d, f) { if (${x}) { function g() { return 1; } } return typeof g; }\nmodule.exports = host;`, SCRIPT); }],
  ['empty-statement', (g) => { const x = e(g); return bodyPair(`if (${x}); return 1;`, `if (${x}) {} return 1;`); }]
];

const sloppyHost = (body) => `function host(a, b, c, d, f) { ${body} }\nmodule.exports = host;`;

const STRICT = [
  ['script-vs-module-this', (g) => sourcePair(sloppyHost('return this === undefined;'), 'export function host(a, b, c, d, f) { return this === undefined; }', { ...SCRIPT, rightEntry: 'src/p/a.mjs', rightMode: 'module' })],
  ['use-strict-directive', (g) => sourcePair(sloppyHost('return typeof this;'), sloppyHost("'use strict'; return typeof this;"), SCRIPT)],
  ['escaped-directive', (g) => sourcePair(sloppyHost("'use strict'; return typeof this;"), sloppyHost("'use\\x20strict'; return typeof this;"), SCRIPT)],
  ['parenthesized-directive', (g) => sourcePair(sloppyHost("'use strict'; return typeof this;"), sloppyHost("('use strict'); return typeof this;"), SCRIPT)],
  ['directive-quote-style', (g) => sourcePair(sloppyHost("'use strict'; return typeof this;"), sloppyHost('"use strict"; return typeof this;'), SCRIPT)],
  ['program-directive', (g) => sourcePair(`'use strict';\n${sloppyHost('return typeof this;')}`, `"use strict";\n${sloppyHost('return typeof this;')}`, SCRIPT)],
  ['sloppy-undeclared-write', (g) => { const x = e(g); return sourcePair(sloppyHost(`u1 = ${x}; return typeof u1;`), sloppyHost(`var u1 = ${x}; return typeof u1;`), SCRIPT); }],
  ['sloppy-arguments-alias', (g) => sourcePair(sloppyHost('arguments[0] = 9; return a;'), sloppyHost("'use strict'; arguments[0] = 9; return a;"), SCRIPT)],
  ['with-statement', (g) => sourcePair(sloppyHost('var o = { a: 2 }; with (o) { return a; }'), sloppyHost('var o = { a: 2 }; { return a; }'), SCRIPT)]
];

export const tryClass = fromRewrites(TRIES);
export const asyncClass = fromRewrites(ASYNC);
export const functionsClass = fromRewrites(FUNCTIONS);
export const blocksClass = fromRewrites(BLOCKS);
export const strictClass = fromRewrites(STRICT);
