// Template trees for Forge tmpl units (engine doc sections 1 and 3, Templates). Vue element subtrees
// (sfc.template.ast from @vue/compiler-sfc) and Babel JSX elements normalize to the same shape:
//   element { type: 'El', tag, attrs, children, loc }   tag is the PascalCase component name
//   attr    { kind: 'static' | 'bind' | 'event' | 'struct' | 'slot' | 'dir', name, value? , exp? }
//   child   element | { type: 'Text', text, loc } | { type: 'Interp', exp, loc }
// class, style, key, ref and id (and JSX className) are passthrough and dropped. Comments are dropped.

const PASSTHROUGH = new Set(['class', 'style', 'key', 'ref', 'id', 'className']);
const STRUCTURAL = { if: 'IF', 'else-if': 'ELSE_IF', else: 'ELSE', for: 'FOR', show: 'SHOW' };
const VUE_NODE = { ELEMENT: 1, TEXT: 2, INTERPOLATION: 5 };
const VUE_PROP = { ATTRIBUTE: 6, DIRECTIVE: 7 };
const JSX_EVENT = /^on[A-Z]/;

const squash = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

const capitalize = (part) => part.charAt(0).toUpperCase() + part.slice(1);

/** 'a-card' -> 'ACard', 'div' -> 'Div', 'ACard' stays. */
export const pascalTag = (tag) => tag.split(/[-_]/).filter(Boolean).map(capitalize).join('');

const vueLoc = (node) => ({ start: node.loc.start.line, end: node.loc.end.line });

const vueArgName = (prop) => {
  const arg = prop.arg;
  if (!arg) return null;
  return arg.isStatic ? arg.content : `[${squash(arg.content)}]`;
};

const vueDirective = (prop) => {
  const name = vueArgName(prop);
  const exp = squash(prop.exp?.content);
  const structural = STRUCTURAL[prop.name];
  const isBind = prop.name === 'bind';
  const isPassthroughBind = isBind && PASSTHROUGH.has(name);
  const isSpreadBind = isBind && !name;
  const byName = {
    bind: () => ({ kind: 'bind', name, exp }),
    on: () => ({ kind: 'event', name: name ?? '', exp }),
    slot: () => ({ kind: 'slot', name: name ?? 'default' })
  };
  if (isPassthroughBind) return null;
  if (structural) return { kind: 'struct', name: structural, exp };
  const isPlainDirective = isSpreadBind || !byName[prop.name];
  if (isPlainDirective) return { kind: 'dir', name: `${prop.name}:${name ?? ''}`, exp };
  return byName[prop.name]();
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
  if (isInterp) return { type: 'Interp', exp: squash(node.content?.content), loc: vueLoc(node) };
  const text = node.type === VUE_NODE.TEXT ? squash(node.content) : '';
  return text ? { type: 'Text', text, loc: vueLoc(node) } : null;
};

/** Normalizes one Vue template ELEMENT node (type 1) and its subtree. */
export const normalizeVueElement = (node) => ({
  type: 'El',
  tag: pascalTag(node.tag),
  attrs: (node.props ?? []).map(vueProp).filter(Boolean),
  children: (node.children ?? []).map(vueChild).filter(Boolean),
  loc: vueLoc(node)
});

/** Top-level elements of a Vue template AST (the ROOT node's element children). */
export const vueRootElements = (templateAst) =>
  (templateAst?.children ?? []).filter((node) => node.type === VUE_NODE.ELEMENT).map(normalizeVueElement);

const jsxLoc = (node) => ({ start: node.loc.start.line, end: node.loc.end.line });
const sourceOf = (node, source) => squash(source.slice(node.start, node.end));

const jsxName = (name) => {
  const isMember = name.type === 'JSXMemberExpression';
  if (isMember) return `${jsxName(name.object)}.${name.property.name}`;
  const isNamespaced = name.type === 'JSXNamespacedName';
  return isNamespaced ? `${name.namespace.name}:${name.name.name}` : name.name;
};

const jsxAttr = (attr, source) => {
  const isSpread = attr.type === 'JSXSpreadAttribute';
  if (isSpread) return { kind: 'dir', name: 'spread:', exp: sourceOf(attr.argument, source) };
  const name = jsxName(attr.name);
  const value = attr.value;
  const isPassthrough = PASSTHROUGH.has(name);
  const isStatic = !value || value.type === 'StringLiteral';
  if (isPassthrough) return null;
  if (isStatic) return { kind: 'static', name, value: value?.value ?? '' };
  const exp = sourceOf(value.expression ?? value, source);
  const isEvent = JSX_EVENT.test(name);
  return isEvent ? { kind: 'event', name: name.slice(2).toLowerCase(), exp } : { kind: 'bind', name, exp };
};

const jsxChild = (node, source) => {
  const isElement = node.type === 'JSXElement' || node.type === 'JSXFragment';
  if (isElement) return normalizeJsxElement(node, source);
  const isContainer = node.type === 'JSXExpressionContainer' && node.expression.type !== 'JSXEmptyExpression';
  if (isContainer) return { type: 'Interp', exp: sourceOf(node.expression, source), loc: jsxLoc(node) };
  const text = node.type === 'JSXText' ? squash(node.value) : '';
  return text ? { type: 'Text', text, loc: jsxLoc(node) } : null;
};

/** Normalizes a Babel JSXElement or JSXFragment; source is the parsed code (for expression text). */
export const normalizeJsxElement = (node, source) => {
  const isFragment = node.type === 'JSXFragment';
  const opening = isFragment ? null : node.openingElement;
  return {
    type: 'El',
    tag: isFragment ? 'Fragment' : pascalTag(jsxName(opening.name)),
    attrs: isFragment ? [] : opening.attributes.map((attr) => jsxAttr(attr, source)).filter(Boolean),
    children: node.children.map((child) => jsxChild(child, source)).filter(Boolean),
    loc: jsxLoc(node)
  };
};
