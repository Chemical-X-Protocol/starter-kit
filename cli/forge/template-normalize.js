// Template trees for Forge tmpl units (engine doc sections 1 and 3, Templates). Vue element subtrees
// (sfc.template.ast from @vue/compiler-sfc) and Babel JSX elements normalize to the same shape:
//   element { type: 'El', tag, attrs, children, loc }   tag is the PascalCase component name
//   attr    { kind: 'static' | 'bind' | 'event' | 'struct' | 'slot' | 'dir', name, value? , exp? }
//   child   element | { type: 'Text', text, loc } | { type: 'Interp', exp, loc }
// class, style, key, ref and id (and JSX className) are passthrough and dropped. Comments are dropped.
// Text keeps what renders (#2586): JSX text goes through the script canonicaliser's jsxTextValue, and Vue
// text is the compiler's own condensed content (raw inside <pre>, &nbsp; kept as U+00A0). Expression
// text keeps string and template literal contents verbatim; only whitespace between tokens collapses.
import { jsxTextValue } from './canon-nodes.js';

const PASSTHROUGH = new Set(['class', 'style', 'key', 'ref', 'id', 'className']);
const STRUCTURAL = { if: 'IF', 'else-if': 'ELSE_IF', else: 'ELSE', for: 'FOR', show: 'SHOW' };
const VUE_NODE = { ELEMENT: 1, TEXT: 2, INTERPOLATION: 5 };
const VUE_PROP = { ATTRIBUTE: 6, DIRECTIVE: 7 };
const JSX_EVENT = /^on[A-Z]/;

const QUOTES = new Set(["'", '"', '`']);

/** End index (exclusive) of the quoted literal that opens at `start`. */
const literalEnd = (text, start) => {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length && text[index] !== quote) index += text[index] === '\\' ? 2 : 1;
  return Math.min(index + 1, text.length);
};

/** The whitespace run starting at `index` ('' when there is none). */
const runAt = (text, index) => {
  const pattern = /\s+/y;
  pattern.lastIndex = index;
  return pattern.exec(text)?.[0] ?? '';
};

const UNSCANNABLE = /\/\*|\\[\r\n]|\/[^/\r\n]*['"][^/\r\n]*\//;

/**
 * Expression source with whitespace between tokens collapsed to one space. Quoted and template literal
 * text is kept verbatim. A same-line run is kept as is when the text has a `/` (it may be a regex), and
 * text with a backtick is kept whole (a template can nest quotes this scanner does not track). When the
 * a run with a line break always collapses to one line break, never a space: a line comment (`//`) and
 * automatic semicolon insertion both depend on it, so `a // c\n + 1` never reads like `a // c + 1`
 * (#2596) and `a = n\nf();` never reads like `a = n f();` (#4560). Text the scanner cannot tokenize
 * reliably is kept whole: a block comment or a regex holding a quote (either can shift the quote
 * state) and a backslash before a line break (a string continuation).
 */
const squashCode = (raw) => {
  const text = String(raw ?? '');
  const isUnscannable = text.includes('`') || UNSCANNABLE.test(text);
  if (isUnscannable) return text.trim();
  const mayHoldRegex = text.includes('/');
  let out = '';
  let index = 0;
  while (index < text.length) {
    const isQuote = QUOTES.has(text[index]);
    const run = isQuote ? '' : runAt(text, index);
    const end = isQuote ? literalEnd(text, index) : index + Math.max(run.length, 1);
    const hasBreak = /[\r\n]/.test(run);
    const keepsRun = mayHoldRegex && !hasBreak;
    const isCollapsible = run.length > 0 && !keepsRun;
    const collapsed = hasBreak ? '\n' : ' ';
    out += isCollapsible ? collapsed : text.slice(index, end);
    index = end;
  }
  return out.trim();
};

const capitalize = (part) => part.charAt(0).toUpperCase() + part.slice(1);

/** 'a-card' -> 'ACard', 'div' -> 'Div', 'ACard' stays. Only '-' splits ('_' is part of the name). */
export const pascalTag = (tag) => tag.split('-').filter(Boolean).map(capitalize).join('');

const isLowerInitial = (tag) => /^[a-z]/.test(tag);

/**
 * The tag identity that is hashed (#2594); `tag` stays the PascalCase display name. A lowercase tag is an
 * element (native or custom) and keeps its text; a capitalised one is a component. Vue resolves a kebab
 * tag to the same component as its PascalCase name, so only a Vue tag with '-' folds; a JSX tag with '-'
 * is a custom element. A JSX member name (`<foo.Bar>`) is always a component.
 */
const vueTagKey = (tag) => {
  const isKebab = tag.includes('-');
  if (isKebab) return pascalTag(tag);
  return isLowerInitial(tag) ? `<${tag}>` : tag;
};

const jsxTagKey = (name) => {
  const isMember = name.includes('.');
  const isElement = !isMember && (isLowerInitial(name) || name.includes('-') || name.includes(':'));
  return isElement ? `<${name}>` : name;
};

/** Vue modifiers, in written order (guard order matters): 3.5 gives nodes, older releases strings. */
const vueModifiers = (prop) => (prop.modifiers ?? []).map((modifier) => modifier?.content ?? String(modifier)).join('.');

const vueLoc = (node) => ({ start: node.loc.start.line, end: node.loc.end.line });

const vueArgName = (prop) => {
  const arg = prop.arg;
  if (!arg) return null;
  return arg.isStatic ? arg.content : `[${squashCode(arg.content)}]`;
};

/** Adds `mods` only when the directive has modifiers, so unmodified attributes keep their shape. */
const withModifiers = (attr, mods) => (mods ? { ...attr, mods } : attr);

const vueDirective = (prop) => {
  const name = vueArgName(prop);
  const exp = squashCode(prop.exp?.content);
  const mods = vueModifiers(prop);
  const structural = STRUCTURAL[prop.name];
  const isBind = prop.name === 'bind';
  const isPassthroughBind = isBind && PASSTHROUGH.has(name);
  const isSpreadBind = isBind && !name;
  const slotExp = prop.exp ? { exp } : {};
  const byName = {
    bind: () => ({ kind: 'bind', name, exp }),
    on: () => ({ kind: 'event', name: name ?? '', exp }),
    slot: () => ({ kind: 'slot', name: name ?? 'default', ...slotExp })
  };
  if (isPassthroughBind) return null;
  if (structural) return { kind: 'struct', name: structural, exp };
  const isPlainDirective = isSpreadBind || !byName[prop.name];
  if (isPlainDirective) return withModifiers({ kind: 'dir', name: `${prop.name}:${name ?? ''}`, exp }, mods);
  return withModifiers(byName[prop.name](), mods);
};

const vueProp = (prop) => {
  const isAttribute = prop.type === VUE_PROP.ATTRIBUTE;
  if (!isAttribute) return vueDirective(prop);
  const isPassthrough = PASSTHROUGH.has(prop.name);
  return isPassthrough ? null : { kind: 'static', name: prop.name, value: prop.value?.content ?? '' };
};

const vueChild = (node) => {
  const isElement = node.type === VUE_NODE.ELEMENT;
  if (isElement) return normalizeVueElement(node);
  const isInterp = node.type === VUE_NODE.INTERPOLATION;
  if (isInterp) return { type: 'Interp', exp: squashCode(node.content?.content), loc: vueLoc(node) };
  const text = node.type === VUE_NODE.TEXT ? String(node.content ?? '') : '';
  return text ? { type: 'Text', text, loc: vueLoc(node) } : null;
};

/** Normalizes one Vue template ELEMENT node (type 1) and its subtree. */
export const normalizeVueElement = (node) => ({
  type: 'El',
  tag: pascalTag(node.tag),
  tagKey: vueTagKey(node.tag),
  attrs: (node.props ?? []).map(vueProp).filter(Boolean),
  children: (node.children ?? []).map(vueChild).filter(Boolean),
  loc: vueLoc(node)
});

/** Top-level elements of a Vue template AST (the ROOT node's element children). */
export const vueRootElements = (templateAst) =>
  (templateAst?.children ?? []).filter((node) => node.type === VUE_NODE.ELEMENT).map(normalizeVueElement);

const jsxLoc = (node) => ({ start: node.loc.start.line, end: node.loc.end.line });
const sourceOf = (node, source) => squashCode(source.slice(node.start, node.end));

const jsxName = (name) => {
  const isMember = name.type === 'JSXMemberExpression';
  if (isMember) return `${jsxName(name.object)}.${name.property.name}`;
  const isNamespaced = name.type === 'JSXNamespacedName';
  return isNamespaced ? `${name.namespace.name}:${name.name.name}` : name.name;
};

/** onClick -> click, onKeyDown -> keyDown: only the first letter folds (React keeps the rest). */
const jsxEventName = (name) => name.charAt(2).toLowerCase() + name.slice(3);

const jsxAttr = (attr, source) => {
  const isSpread = attr.type === 'JSXSpreadAttribute';
  if (isSpread) return { kind: 'dir', name: 'spread:', exp: sourceOf(attr.argument, source) };
  const name = jsxName(attr.name);
  const value = attr.value;
  const isPassthrough = PASSTHROUGH.has(name);
  const isFlag = !value;
  const isStatic = value?.type === 'StringLiteral';
  if (isPassthrough) return null;
  if (isFlag) return { kind: 'static', name, value: '', isFlag: true };
  if (isStatic) return { kind: 'static', name, value: value.value };
  const exp = sourceOf(value.expression ?? value, source);
  const isEvent = JSX_EVENT.test(name);
  return isEvent ? { kind: 'event', name: jsxEventName(name), exp } : { kind: 'bind', name, exp };
};

const jsxChild = (node, source) => {
  const isElement = node.type === 'JSXElement' || node.type === 'JSXFragment';
  if (isElement) return normalizeJsxElement(node, source);
  const isContainer = node.type === 'JSXExpressionContainer' && node.expression.type !== 'JSXEmptyExpression';
  if (isContainer) return { type: 'Interp', exp: sourceOf(node.expression, source), loc: jsxLoc(node) };
  const text = node.type === 'JSXText' ? jsxTextValue(node.value) : '';
  return text ? { type: 'Text', text, loc: jsxLoc(node) } : null;
};

/** Normalizes a Babel JSXElement or JSXFragment; source is the parsed code (for expression text). */
export const normalizeJsxElement = (node, source) => {
  const isFragment = node.type === 'JSXFragment';
  const opening = isFragment ? null : node.openingElement;
  const name = isFragment ? null : jsxName(opening.name);
  return {
    type: 'El',
    tag: isFragment ? 'Fragment' : pascalTag(name),
    tagKey: isFragment ? '<>' : jsxTagKey(name),
    attrs: isFragment ? [] : opening.attributes.map((attr) => jsxAttr(attr, source)).filter(Boolean),
    children: node.children.map((child) => jsxChild(child, source)).filter(Boolean),
    loc: jsxLoc(node)
  };
};
