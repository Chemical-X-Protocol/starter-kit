// Fuzz generators for objects and classes (#2596): getters/setters and implicit conversions,
// __proto__ in literals, class fields, static blocks, private members and method kinds, spread and
// iterators, and optional chaining (where the stripped parentheses of canon-nodes.js matter).
import { bodyPair, expr, fromRewrites } from './gen-kit.js';
import { formPair } from './gen-logic.js';

const e = (g) => expr(g, 2);
const objectish = (g) => g.pick(['a', 'b', '({ x: f(1) })', 'c', '({ x: { y: f(2) } })', 'd']);

const ACCESSORS = [
  ['getter-vs-value', (g) => { const x = e(g); return bodyPair(`const o = { get x() { return ${x}; } }; return [o.x, o.x];`, `const o = { x: ${x} }; return [o.x, o.x];`); }],
  ['getter-vs-method', (g) => { const x = e(g); return bodyPair(`const o = { get x() { return ${x}; } }; return o;`, `const o = { x() { return ${x}; } }; return o;`); }],
  ['method-vs-function-property', (g) => { const x = e(g); return bodyPair(`const o = { m() { return ${x}; } }; return [o.m(), Reflect.construct.length, typeof o.m.prototype];`, `const o = { m: function () { return ${x}; } }; return [o.m(), Reflect.construct.length, typeof o.m.prototype];`); }],
  ['method-vs-arrow-property', (g) => bodyPair('const o = { v: 1, m() { return this?.v; } }; return o.m();', 'const o = { v: 1, m: () => this?.v }; return o.m();')],
  ['accessor-order', (g) => { const x = e(g); return bodyPair(`const o = { get x() { return ${x}; }, set x(v) { f(v); } }; o.x = 1; return Object.keys(o);`, `const o = { set x(v) { f(v); }, get x() { return ${x}; } }; o.x = 1; return Object.keys(o);`); }],
  ['to-primitive-hint', (g) => { const x = objectish(g); return formPair(g, `\`\${${x}}\``, `(${x} + '')`); }],
  ['setter-vs-field', (g) => { const x = e(g); return bodyPair(`class B { set v(n) { f(n); } } class C extends B { v = ${x}; } return new C();`, `class B { set v(n) { f(n); } } class C extends B { constructor() { super(); this.v = ${x}; } } return new C();`); }],
  ['static-getter', (g) => { const x = e(g); return bodyPair(`class C { static get v() { return ${x}; } } return [C.v, new C().v];`, `class C { get v() { return ${x}; } } return [C.v, new C().v];`); }]
];

const PROTO = [
  ['proto-string-key', (g) => { const x = objectish(g); return formPair(g, `({ __proto__: ${x} })`, `({ "__proto__": ${x} })`); }],
  ['proto-computed', (g) => { const x = objectish(g); return formPair(g, `({ __proto__: ${x} })`, `({ ["__proto__"]: ${x} })`); }],
  ['proto-shorthand', (g) => bodyPair('const __proto__ = a; return { __proto__ };', 'const __proto__ = a; return { __proto__: __proto__ };')],
  ['proto-method', (g) => { const x = e(g); return formPair(g, `({ __proto__() { return ${x}; } })`, `({ __proto__: function () { return ${x}; } })`); }],
  ['proto-spread', (g) => { const x = objectish(g); return formPair(g, `({ ...{ __proto__: ${x} } })`, `({ __proto__: ${x} })`); }],
  ['proto-pattern', (g) => { const x = objectish(g); return bodyPair(`const { __proto__: p } = ${x} ?? {}; return p;`, `const { ["__proto__"]: p } = ${x} ?? {}; return p;`); }],
  ['proto-class-field', (g) => { const x = objectish(g); return bodyPair(`class C { __proto__ = ${x}; } return new C();`, `class C { constructor() { this.__proto__ = ${x}; } } return new C();`); }],
  ['proto-quote-style', (g) => { const x = objectish(g); return formPair(g, `({ '__proto__': ${x} })`, `({ "__proto__": ${x} })`); }]
];

const CLASS_MEMBERS = [
  ['field-vs-constructor', (g) => { const x = e(g); return bodyPair(`class C { v = ${x}; } return new C();`, `class C { constructor() { this.v = ${x}; } } return new C();`); }],
  ['static-field-vs-block', (g) => { const x = e(g); return bodyPair(`class C { static v = ${x}; } return C.v;`, `class C { static { this.v = ${x}; } } return C.v;`); }],
  ['private-vs-public-read', (g) => { const x = e(g); return { ...bodyPair(`class C { #v = 1; static read(o) { return o.#v; } } return C.read(${x});`, `class C { _v = 1; static read(o) { return o._v; } } return C.read(${x});`), unit: { kind: 'fn', declName: 'read' } }; }],
  ['private-in', (g) => { const x = e(g); return bodyPair(`class C { #v = 1; static has(o) { return #v in o; } } return C.has(${x} ?? {});`, `class C { '#v' = 1; static has(o) { return '#v' in o; } } return C.has(${x} ?? {});`); }],
  ['method-vs-arrow-field', (g) => { const x = e(g); return bodyPair(`class C { m() { return ${x}; } } const o = new C(); return [o.m(), Object.keys(o)];`, `class C { m = () => ${x}; } const o = new C(); return [o.m(), Object.keys(o)];`); }],
  ['static-vs-instance-method', (g) => { const x = e(g); return bodyPair(`class C { static m() { return ${x}; } } return [typeof C.m, typeof new C().m];`, `class C { m() { return ${x}; } } return [typeof C.m, typeof new C().m];`); }],
  ['string-constructor-key', (g) => { const x = e(g); return bodyPair(`class C { constructor() { this.v = ${x}; } } return new C();`, `class C { 'constructor'() { this.v = ${x}; } } return new C();`); }],
  ['computed-constructor-key', (g) => { const x = e(g); return bodyPair(`class C { constructor() { this.v = ${x}; } } return new C();`, `class C { ['constructor']() { this.v = ${x}; } } return new C();`); }],
  ['field-order', (g) => bodyPair('class C { p = f(1); q = f(2); } return new C();', 'class C { q = f(2); p = f(1); } return new C();', { abstracts: true })],
  ['private-method', (g) => { const x = e(g); return { ...bodyPair(`class C { #m() { return ${x}; } run() { return this.#m(); } } return C.prototype.run.call(${x});`, `class C { _m() { return ${x}; } run() { return this._m(); } } return C.prototype.run.call(${x});`), unit: { kind: 'fn', declName: 'run' } }; }],
  ['accessor-keyword', (g) => { const x = e(g); return bodyPair(`class C { accessor v = ${x}; } return Object.keys(new C());`, `class C { v = ${x}; } return Object.keys(new C());`); }],
  ['class-expression-name', (g) => bodyPair('const K = class Inner { m() { return typeof Inner; } }; return new K().m();', 'const K = class { m() { return typeof Inner; } }; return new K().m();')],
  ['field-this-arrow', (g) => bodyPair('class C { v = 1; m = () => this.v; } const { m } = new C(); return m();', 'class C { v = 1; m() { return this?.v; } } const { m } = new C(); return m();')],
  ['static-block-this', (g) => { const x = e(g); return bodyPair(`let seen; class C { static { seen = this; } static v = ${x}; } return [seen === C, C.v];`, `let seen; class C { static v = ${x}; static { seen = this; } } return [seen === C, C.v];`); }]
];

const SPREADS = [
  ['spread-vs-array-from', (g) => { const x = objectish(g); return formPair(g, `[...(${x} ?? [])]`, `Array.from(${x} ?? [])`); }],
  ['spread-call-vs-apply', (g) => { const x = objectish(g); return bodyPair(`return f(...(${x} ?? []));`, `return f.apply(undefined, ${x} ?? []);`); }],
  ['object-spread-vs-assign', (g) => { const x = objectish(g); return formPair(g, `({ ...${x} })`, `Object.assign({}, ${x})`); }],
  ['spread-order', (g) => { const [x, y] = [objectish(g), objectish(g)]; return formPair(g, `[...(${x} ?? []), ...(${y} ?? [])]`, `[...(${y} ?? []), ...(${x} ?? [])]`, { abstracts: true }); }],
  ['spread-vs-element', (g) => { const x = objectish(g); return formPair(g, `[...(${x} ?? [])]`, `[${x} ?? []]`); }],
  ['object-spread-order', (g) => { const x = objectish(g); return formPair(g, `({ ...${x}, x: 1 })`, `({ x: 1, ...${x} })`); }],
  ['spread-literal-call', (g) => { const x = e(g); return bodyPair(`return f(...[${x}]);`, `return f(${x});`); }],
  ['for-of-vs-for-in', (g) => { const x = objectish(g); return bodyPair(`const out = []; for (const v of (${x} ?? [])) { out.push(v); } return out;`, `const out = []; for (const v in (${x} ?? [])) { out.push(v); } return out;`); }]
];

const OPTIONALS = [
  ['optional-continue', (g) => { const x = objectish(g); return formPair(g, `${x}?.x.y`, `${x}?.x?.y`); }],
  ['optional-parens-member', (g) => { const x = objectish(g); return formPair(g, `(${x}?.x).y`, `${x}?.x.y`); }],
  ['optional-parens-call', (g) => bodyPair('const o = { v: 7, m() { return this?.v; } }; return [(a ? o : null)?.m(), (o?.m)()];', 'const o = { v: 7, m() { return this?.v; } }; return [(a ? o : null)?.m(), o?.m()];')],
  ['optional-call-vs-and', (g) => { const x = g.pick(['a', 'b', 'f', 'c']); return formPair(g, `${x}?.()`, `(${x} && ${x}())`); }],
  ['optional-computed', (g) => { const x = objectish(g); return formPair(g, `${x}?.['x']`, `${x}?.x`); }],
  ['optional-delete', (g) => bodyPair('const o = a ?? { x: 1 }; return [delete o?.x, o];', 'const o = a ?? { x: 1 }; return [delete o.x, o];')],
  ['optional-vs-ternary', (g) => { const x = g.pick(['a', 'b', 'c']); return formPair(g, `${x}?.x`, `(${x} == null ? undefined : ${x}.x)`); }],
  ['parens-this-call', (g) => bodyPair('const o = { v: 1, m() { return this?.v; } }; return (o.m)();', 'const o = { v: 1, m() { return this?.v; } }; return (0, o.m)();')],
  ['parens-same-call', (g) => bodyPair('const o = { v: 1, m() { return this?.v; } }; return (o.m)();', 'const o = { v: 1, m() { return this?.v; } }; return o.m();')],
  ['ts-nonnull-chain', (g) => { const x = objectish(g); return formPair(g, `${x}?.x!.y`, `${x}?.x.y`); }],
  ['ts-nonnull-parens', (g) => { const x = objectish(g); return formPair(g, `(${x}?.x)!.y`, `${x}?.x.y`); }],
  ['ts-as-chain', (g) => { const x = objectish(g); return formPair(g, `(${x}?.x as any).y`, `${x}?.x.y`); }]
];

const KEY_FORMS = [['x', "'x'"], ['1', "'1'"], ['1', '1.0'], ['1', '0x1'], ['1', '1n'], ['1', "'01'"], ['1e21', "'1e+21'"], ['x', '"x"'], ["'a b'", '"a b"'], ['0', '-0'], ['0.5', "'.5'"]];

// Key spellings: the same key must merge soundly at L1; a different key is a name L2 erases (KEY).
const KEYS = [
  ['object-key-form', (g) => { const [left, right] = g.pick(KEY_FORMS); const x = e(g); return formPair(g, `({ ${left}: ${x} })`, `({ ${right}: ${x} })`, { abstracts: true }); }],
  ['class-key-form', (g) => { const [left, right] = g.pick(KEY_FORMS); const x = e(g); return bodyPair(`class C { ${left}() { return ${x}; } } return Object.getOwnPropertyNames(C.prototype);`, `class C { ${right}() { return ${x}; } } return Object.getOwnPropertyNames(C.prototype);`, { abstracts: true }); }],
  ['pattern-key-form', (g) => { const [left, right] = g.pick(KEY_FORMS); return bodyPair(`const { ${left}: v } = a ?? {}; return v;`, `const { ${right}: v } = a ?? {}; return v;`, { abstracts: true }); }],
  ['member-vs-computed', (g) => { const x = objectish(g); return formPair(g, `(${x} ?? {}).x`, `(${x} ?? {})['x']`); }],
  ['numeric-literal-form', (g) => { const [left, right] = g.pick([['1000', '1_000'], ['0.0', '0'], ['9007199254740993', '9007199254740992'], ['0x10', '16'], ['1e3', '1000'], ['.5', '0.5'], ['10n', '0xan']]); return formPair(g, left, right); }],
  ['string-literal-form', (g) => { const [left, right] = g.pick([["'\\x41'", "'A'"], ["'\\u{41}'", "'A'"], ['"a"', "'a'"], ["'\\0'", "'\\x00'"], ["'\\\n'", "''"]]); return formPair(g, left, right); }]
];

export const keysClass = fromRewrites(KEYS);
export const accessorsClass = fromRewrites(ACCESSORS);
export const protoClass = fromRewrites(PROTO);
export const classMembersClass = fromRewrites(CLASS_MEMBERS);
export const spreadClass = fromRewrites(SPREADS);
export const optionalClass = fromRewrites(OPTIONALS);
