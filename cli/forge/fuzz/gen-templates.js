// Fuzz generators for template units (#2596): JSX and Vue element subtrees (template-normalize.js,
// template-units.js). Each pair replaces the first <li> of a four-item list (the tmpl unit is the <ul>)
// with two variants: tag case, valueless attributes, event name case, modifiers, slot props, attribute
// order around binds and spreads, and the whitespace, entities and comments of text and expressions.
// Static text is literal (L2 erases it), so text-only rewrites are checked at L1 only.
import { fromRewrites, templateSide } from './gen-kit.js';

const UNIT = Object.freeze({ kind: 'tmpl', tag: 'Ul' });
const listItems = '\n    <li>b</li>\n    <li>c</li>\n    <li>d</li>';
const jsxList = (first) => `export const host = (p) => (\n  <ul>\n    ${first}${listItems}\n  </ul>\n);`;
const vueList = (first) => `<template>\n  <ul>\n    ${first}${listItems}\n  </ul>\n</template>`;

const jsxPair = (left, right, abstracts = false) => ({ left: templateSide(jsxList(left), 'src/a.jsx'), right: templateSide(jsxList(right), 'src/a.jsx'), unit: UNIT, abstracts });
const vuePair = (left, right, abstracts = false) => ({ left: templateSide(vueList(left), 'src/a.vue'), right: templateSide(vueList(right), 'src/a.vue'), unit: UNIT, abstracts });
const el = (tag, attrs = '', inner = 'a') => `<${tag}${attrs}>${inner}</${tag}>`;

const JSX_TAGS = [['div', 'Div'], ['my-el', 'MyEl'], ['item', 'Item'], ['button', 'Button'], ['li', 'Li'], ['Foo', 'foo']];
const JSX_ATTRS = [
  [' disabled', ' disabled=""'], [' disabled', ' disabled={true}'], [" disabled=''", ' disabled=""'],
  [' onClick={p.f}', ' onclick={p.f}'], [' onKeyDown={p.f}', ' onKeydown={p.f}'], [' onClick={p.f}', ' onClick={p.g}', true],
  [' title="s" alt="t"', ' alt="t" title="s"'], [' title="s" {...p}', ' {...p} title="s"'], [' title="s" title={p.b}', ' title={p.b} title="s"'],
  [" title='s'", ' title="s"'], [' title="a&amp;b"', ' title="a&b"', true], [' className="a"', ' className="b"'], [' title={p.a}', ' title={ p.a }', true],
  [' data-x="1"', ' data-X="1"'], [' aria-label="s"', ' ariaLabel="s"'],
  // Handler statements with line breaks (#4560): ASI makes a break differ from a space.
  [' onClick={() => { let async = p.f; async\nfunction g() { p.g(); } return g(); }}', ' onClick={() => { let async = p.f; async function g() { p.g(); } return g(); }}', true],
  [' onClick={() => { p.a = p.n\np.f(); }}', ' onClick={() => { p.a = p.n; p.f(); }}', true], [' onClick={() => { p.f();\n\n p.g(); }}', ' onClick={() => { p.f();\n p.g(); }}', true],
  [" title={/'/.source + 'x\\\n  y'}", " title={/'/.source + 'x\\ y'}", true], [" title={p.a /* it's */ + 'x\\\n  y'}", " title={p.a /* it's */ + 'x\\ y'}", true]
];
const JSX_TEXT = [
  ['a  b', 'a b', true], ['a\n      b', 'a b'], ['x&nbsp;y', 'x y'], ['a&amp;b', 'a&b'], [' a', 'a', true], ["{'a'}", 'a'],
  ['{p.a}', '{ p.a }'], ['{p.a // c\n}', '{p.a}'], ['{p.a /* c */}', '{p.a}'], ['{`x  y`}', '{`x y`}'], ['{/a  b/.source}', '{/a b/.source}'],
  ['{p.a  +  1}', '{p.a + 1}'], ['{p.a}{p.b}', '{p.b}{p.a}'], ['{"x  y"}', '{"x y"}'], ['a\n\n      b', 'a\n      b']
];

const VUE_TAGS = [['button', 'Button'], ['my-el', 'MyEl'], ['my_el', 'my-el'], ['comp', 'Comp'], ['item', 'Item'], ['li', 'Li']];
const VUE_ATTRS = [
  [' @click.prevent="f"', ' @click="f"'], [' @click.prevent.stop="f"', ' @click.stop.prevent="f"'], [' @keyup.enter="f"', ' @keyup="f"'],
  [' @click="f"', ' v-on:click="f"'], [' :title="b"', ' v-bind:title="b"'], [' @click.once="f"', ' @click="f"'],
  [' :foo.prop="n"', ' :foo="n"'], [' :foo.prop="n"', ' .foo="n"'], [' disabled', ' disabled=""'], [' disabled', ' :disabled="true"'],
  [' title="s" role="x"', ' role="x" title="s"'], [' title="s" :title="b"', ' :title="b" title="s"'], [' title="s" v-bind="obj"', ' v-bind="obj" title="s"'],
  [' :[k]="v" title="s"', ' title="s" :[k]="v"'], [' class="a"', ' class="b"'], [' @click="f"', ' @click="f()"', true], [' @click="f"', ' @click="g"', true],
  [' :title="a+1"', ' :title="a + 1"', true], [' :title="a  +  1"', ' :title="a + 1"', true],
  [' @keyup="async\nfunction g() { f(); } g();"', ' @keyup="async function g() { f(); } g();"', true], [' @keyup="a = n\nf();"', ' @keyup="a = n f();"', true],
  [' @keyup="a = b\n++n;"', ' @keyup="a = b ++n;"', true], [' @click="a = n;  f();"', ' @click="a = n; f();"', true], [' @click="a = n;\n\n f();"', ' @click="a = n;\n f();"', true],
  [" :title=\"/'/.source + 'x\\\n  y'\"", " :title=\"/'/.source + 'x\\ y'\"", true]
];
const VUE_INNERS = [
  ['<input v-model.number="n">', '<input v-model="n">'], ['<input v-model.trim="n">', '<input v-model="n">'], ['<input v-model="n" value="a">', '<input value="a" v-model="n">'],
  ['<Comp #item="{ a }">{{ a }}</Comp>', '<Comp #item="{ b: a }">{{ a }}</Comp>', true], ['<Comp #item="{ a }">{{ a }}</Comp>', '<Comp v-slot:item="{ a }">{{ a }}</Comp>'],
  ['<Comp #item>x</Comp>', '<Comp #default>x</Comp>'], ['<Comp>x</Comp>', '<Comp #default>x</Comp>'],
  ['<i v-if="a">x</i>', '<i v-show="a">x</i>'], ['<i v-if="a">x</i><i v-else>y</i>', '<i v-if="a">x</i><i v-if="!a">y</i>']
];
const VUE_TEXT = [
  ['a  b', 'a b'], ['<pre>a  b</pre>', '<pre>a b</pre>'], ['x&nbsp;y', 'x y'], ['{{ a  +  1 }}', '{{ a + 1 }}'], ['{{ a // c\n + 1 }}', '{{ a // c + 1 }}'],
  ["{{ 'x  y' }}", "{{ 'x y' }}"], ['{{ `x  y` }}', '{{ `x y` }}'], ['{{ /a  b/.source }}', '{{ /a b/.source }}'], ['{{ a }}', '{{a}}'],
  ['{{ a }}{{ b }}', '{{ b }}{{ a }}'], ['a\n      b', 'a b'], ['<textarea>a  b</textarea>', '<textarea>a b</textarea>']
];

const TEMPLATES = [
  ['jsx-tag-case', (g) => { const [left, right] = g.pick(JSX_TAGS); return jsxPair(el(left), el(right)); }],
  ['jsx-attribute', (g) => { const [left, right, isHole] = g.pick(JSX_ATTRS); const tag = g.pick(['li', 'Item']); return jsxPair(el(tag, left), el(tag, right), Boolean(isHole)); }],
  ['jsx-text', (g) => { const [left, right] = g.pick(JSX_TEXT); return jsxPair(el('li', '', left), el('li', '', right), true); }],
  ['vue-tag-case', (g) => { const [left, right] = g.pick(VUE_TAGS); return vuePair(el('li', '', el(left)), el('li', '', el(right))); }],
  ['vue-attribute', (g) => { const [left, right, isHole] = g.pick(VUE_ATTRS); const tag = g.pick(['li', 'Comp', 'input']); return vuePair(el('li', '', el(tag, left)), el('li', '', el(tag, right)), Boolean(isHole)); }],
  ['vue-element', (g) => { const [left, right, isHole] = g.pick(VUE_INNERS); return vuePair(el('li', '', left), el('li', '', right), Boolean(isHole)); }],
  ['vue-text', (g) => { const [left, right] = g.pick(VUE_TEXT); return vuePair(el('li', '', left), el('li', '', right), true); }]
];

export const templatesClass = fromRewrites(TEMPLATES);

// JSX inside fn units (#2596): the script canonicalizer's JSX text and attribute handling, evaluated
// through the harness __h recorder in plain (not template) mode, so className and key count too.
const jsxHost = (inner) => `export function host(a, b, c, d, f) { return ${inner}; }`;
const JSX_SCRIPT = [
  ['<b>a\n      b</b>', '<b>a b</b>'], ['<b> a</b>', '<b>a</b>'], ['<b>a&amp;b</b>', '<b>a&b</b>'], ['<b>x&nbsp;y</b>', '<b>x y</b>'],
  ["<b title='s' />", '<b title="s" />'], ['<b></b>', '<b />'], ["<b>{'a'}</b>", '<b>a</b>'], ['<b title="s" alt="t" />', '<b alt="t" title="s" />'],
  ['<b {...a} title="s" />', '<b title="s" {...a} />'], ['<b disabled />', '<b disabled={true} />'], ['<b>{a}{b}</b>', '<b>{b}{a}</b>'],
  ['<>{a}</>', '<b>{a}</b>'], ['<b>{/* c */}a</b>', '<b>a</b>'], ['<b>a{" "}b</b>', '<b>a b</b>'], ['<b>\n  a\n</b>', '<b>a</b>'],
  ['<b title="a&amp;b" />', '<b title="a&b" />'], ['<B />', '<b />'], ['<my-el />', '<MyEl />']
];
const jsxScriptPair = (g) => {
  const [left, right] = g.pick(JSX_SCRIPT);
  const prefix = 'const B = (p) => p; const MyEl = (p) => p;\n';
  return { left: templateSide(`${prefix}${jsxHost(left)}`, 'src/p/a.tsx'), right: templateSide(`${prefix}${jsxHost(right)}`, 'src/p/a.tsx') };
};

export const jsxScriptClass = fromRewrites([['jsx-in-function', jsxScriptPair]]);
