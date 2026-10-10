// Fuzz generators for boolean logic, comparisons and implicit conversions, and template literals
// (#2596). Each rewrite is one textual change the canonicalizer might normalize (canon-logic.js,
// canon-nodes.js): some are sound (the hash may merge them), some change behaviour (it must not).
import { BODY_FORMS, bodyPair, expr, fromRewrites } from './gen-kit.js';

/** Both sides in the same body form, so the expressions are the only difference. */
export const formPair = (g, left, right, options = {}) => {
  const form = g.pick(BODY_FORMS);
  return bodyPair(form(left), form(right), options);
};

const e = (g) => expr(g, 2);

const LOGIC = [
  ['de-morgan-and', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(!${x} && !${y})`, `!(${x} || ${y})`); }],
  ['de-morgan-or', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(!${x} || !${y})`, `!(${x} && ${y})`); }],
  ['de-morgan-wrong-dual', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(!${x} && !${y})`, `!(${x} && ${y})`); }],
  ['de-morgan-wrong-same', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(!${x} || !${y})`, `!(${x} || ${y})`); }],
  ['and-assoc', (g) => { const [x, y, z] = [e(g), e(g), e(g)]; return formPair(g, `((${x} && ${y}) && ${z})`, `(${x} && (${y} && ${z}))`); }],
  ['or-assoc', (g) => { const [x, y, z] = [e(g), e(g), e(g)]; return formPair(g, `((${x} || ${y}) || ${z})`, `(${x} || (${y} || ${z}))`); }],
  ['mixed-assoc', (g) => { const [x, y, z] = [e(g), e(g), e(g)]; return formPair(g, `(${x} && (${y} || ${z}))`, `((${x} && ${y}) || ${z})`); }],
  ['nullish-assoc', (g) => { const [x, y, z] = [e(g), e(g), e(g)]; return formPair(g, `((${x} ?? ${y}) ?? ${z})`, `(${x} ?? (${y} ?? ${z}))`); }],
  ['nullish-as-or', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(${x} ?? ${y})`, `(${x} || ${y})`); }],
  // Swapping two random operands of one shape that differ only in names or literals is an L2 merge by design.
  ['operand-swap', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(${x} && ${y})`, `(${y} && ${x})`, { abstracts: true }); }],
  ['strict-inequality', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(${x} !== ${y})`, `!(${x} === ${y})`); }],
  ['loose-inequality', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(${x} != ${y})`, `!(${x} == ${y})`); }],
  ['inequality-strength', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(${x} !== ${y})`, `!(${x} == ${y})`); }],
  ['double-not', (g) => { const x = e(g); return formPair(g, `!!${x}`, x); }],
  ['boolean-call', (g) => { const x = e(g); return formPair(g, `Boolean(${x})`, x); }],
  ['boolean-vs-not-not', (g) => { const x = e(g); return formPair(g, `Boolean(${x})`, `!!${x}`); }],
  ['boolean-in-and', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(Boolean(${x}) && ${y})`, `(${x} && ${y})`); }],
  ['boolean-in-nullish', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(Boolean(${x}) ?? ${y})`, `(${x} ?? ${y})`); }],
  ['boolean-in-equality', (g) => { const x = e(g); return formPair(g, `(Boolean(${x}) === true)`, `(${x} === true)`); }],
  ['boolean-in-sequence', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(${y}, Boolean(${x}))`, `(${y}, ${x})`); }],
  ['boolean-two-args', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `Boolean(${x}, ${y})`, x); }],
  ['boolean-spread', (g) => { const x = e(g); return formPair(g, `Boolean(...[${x}])`, x); }],
  ['boolean-optional-call', (g) => { const x = e(g); return formPair(g, `Boolean?.(${x})`, x); }],
  ['new-boolean', (g) => { const x = e(g); return formPair(g, `new Boolean(${x})`, x); }],
  ['shadowed-boolean', (g) => { const x = e(g); return bodyPair(`const Boolean = (v) => !v; if (Boolean(${x})) { return 1; } return 2;`, `const Boolean = (v) => !v; if (${x}) { return 1; } return 2;`); }],
  ['ternary-negation', (g) => { const [x, y, z] = [e(g), e(g), e(g)]; return formPair(g, `(${x} ? ${y} : ${z})`, `(!${x} ? ${z} : ${y})`); }],
  ['not-in-ternary-test', (g) => { const [x, y, z] = [e(g), e(g), e(g)]; return formPair(g, `(Boolean(${x}) ? ${y} : ${z})`, `(${x} ? ${y} : ${z})`); }],
  ['boolean-ternary-branch', (g) => { const [x, y, z] = [e(g), e(g), e(g)]; return formPair(g, `(${x} ? Boolean(${y}) : ${z})`, `(${x} ? ${y} : ${z})`); }]
];

const COMPARE = [
  ['flip-less', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(${x} < ${y})`, `(${y} > ${x})`); }],
  ['less-equal-as-not-greater', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(${x} <= ${y})`, `!(${x} > ${y})`); }],
  ['flip-loose-equal', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(${x} == ${y})`, `(${y} == ${x})`, { abstracts: true }); }],
  ['flip-strict-equal', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(${x} === ${y})`, `(${y} === ${x})`, { abstracts: true }); }],
  ['null-check', (g) => { const x = e(g); return formPair(g, `(${x} == null)`, `(${x} === null || ${x} === undefined)`); }],
  ['to-string-concat', (g) => { const x = e(g); return formPair(g, `(${x} + '')`, `String(${x})`); }],
  ['to-string-template', (g) => { const x = e(g); return formPair(g, `\`\${${x}}\``, `String(${x})`); }],
  ['concat-vs-template', (g) => { const x = e(g); return formPair(g, `('' + ${x})`, `\`\${${x}}\``); }],
  ['unary-plus', (g) => { const x = e(g); return formPair(g, `+${x}`, `Number(${x})`); }],
  ['minus-zero', (g) => { const x = e(g); return formPair(g, `(${x} - 0)`, `+${x}`); }],
  ['times-one', (g) => { const x = e(g); return formPair(g, `(${x} * 1)`, `(1 * ${x})`); }],
  ['typeof-undefined', (g) => { const x = g.pick(['a', 'u', 'a.x']); return formPair(g, `(typeof ${x} === 'undefined')`, `(${x} === undefined)`); }],
  ['plus-assoc', (g) => { const [x, y, z] = [e(g), e(g), e(g)]; return formPair(g, `((${x} + ${y}) + ${z})`, `(${x} + (${y} + ${z}))`); }],
  ['in-operand-swap', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `(${x} in ${y})`, `(${y} in ${x})`, { abstracts: true }); }]
];

const TEMPLATE_LITERALS = [
  ['plain-template', (g) => { const text = g.pick(['x', 'a b', '', '\\n', '\\u0041']); return formPair(g, `\`${text}\``, `'${text}'`); }],
  // Literal text: L2 erases it by design (TPL(n), STR), so these are checked at L1 only.
  ['template-escape-forms', (g) => { const [left, right] = g.pick([['\\u0041', 'A'], ['\\x41', 'A'], ['\\n', '\\x0a'], ['\\`', '`']]); return formPair(g, `\`${left}\``, `\`${right}\``, { abstracts: true }); }],
  ['raw-tag-escapes', (g) => { const [left, right] = g.pick([['\\u0041', 'A'], ['\\n', '\\x0a'], ['a\\\\b', 'a\\b']]); return formPair(g, `String.raw\`${left}\``, `String.raw\`${right}\``, { abstracts: true }); }],
  ['raw-tag-vs-string', (g) => { const text = g.pick(['\\n', 'a', '\\u0041']); return formPair(g, `String.raw\`${text}\``, `'${text}'`); }],
  ['tag-vs-call', (g) => { const x = e(g); return formPair(g, `f\`a\${${x}}\``, `f(['a', ''], ${x})`); }],
  ['template-vs-concat', (g) => { const x = e(g); return formPair(g, `\`a\${${x}}b\``, `('a' + ${x} + 'b')`); }],
  ['template-order', (g) => { const [x, y] = [e(g), e(g)]; return formPair(g, `\`\${${x}}\${${y}}\``, `\`\${${y}}\${${x}}\``, { abstracts: true }); }],
  ['template-line-continuation', (g) => formPair(g, '`a\\\nb`', "'ab'")]
];

export const logicClass = fromRewrites(LOGIC);
export const compareClass = fromRewrites(COMPARE);
export const templateLiteralClass = fromRewrites(TEMPLATE_LITERALS);
