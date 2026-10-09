/**
 * Walks a @vue/compiler-dom template AST (from parseSfc) and yields elements,
 * static attributes and bound expressions with their Babel AST and file location.
 */
export const NODE = Object.freeze({ ELEMENT: 1, INTERPOLATION: 5, ATTRIBUTE: 6, DIRECTIVE: 7 });
export const TAG_TYPE = Object.freeze({ ELEMENT: 0, COMPONENT: 1, SLOT: 2, TEMPLATE: 3 });

const SKIPPED_BABEL_KEYS = new Set(['loc', 'start', 'end', 'extra', 'comments', 'errors', 'leadingComments', 'trailingComments', 'innerComments']);

const isBabelNode = (value) => value !== null && typeof value === 'object' && typeof value.type === 'string';

/** Depth-first visit of a Babel node: visit(node, parent). */
export const walkBabel = (node, visit, parent = null) => {
  if (!isBabelNode(node)) return;
  visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    const isSkippedKey = SKIPPED_BABEL_KEYS.has(key);
    if (isSkippedKey) continue;
    const children = Array.isArray(value) ? value : [value];
    for (const child of children) walkBabel(child, visit, node);
  }
};

/** Maps a location inside a template expression to a file line and column. */
export const resolveExpressionLocation = (exp, babelNode = null) => {
  const relStart = babelNode?.loc?.start;
  const relLine = relStart?.line ?? 1;
  const relColumn = relStart?.column ?? 1;
  const isFirstLine = relLine === 1;
  const line = exp.loc.start.line + relLine - 1;
  const column = isFirstLine ? exp.loc.start.column + Math.max(0, relColumn - 1) : relColumn + 1;
  return { line, column };
};

const toExpressionEntry = (exp, extra) => {
  const hasAst = isBabelNode(exp.ast);
  return { exp, ast: hasAst ? exp.ast : null, source: exp.content, ...extra };
};

const visitProps = (element, handlers) => {
  for (const prop of element.props || []) {
    const isAttribute = prop.type === NODE.ATTRIBUTE;
    if (isAttribute) handlers.onAttribute?.({ attribute: prop, element });
    const hasExpression = prop.type === NODE.DIRECTIVE && Boolean(prop.exp);
    if (hasExpression) {
      const directive = { name: prop.name, arg: prop.arg?.content ?? null };
      handlers.onExpression?.(toExpressionEntry(prop.exp, { kind: 'directive', directive, element }));
    }
  }
};

/** handlers: { onElement, onAttribute, onExpression } (all optional). */
export const walkTemplate = (root, handlers = {}) => {
  if (!root) return;
  const visit = (node) => {
    const isElement = node.type === NODE.ELEMENT;
    if (isElement) {
      handlers.onElement?.(node);
      visitProps(node, handlers);
    }
    const isInterpolation = node.type === NODE.INTERPOLATION && Boolean(node.content);
    if (isInterpolation) handlers.onExpression?.(toExpressionEntry(node.content, { kind: 'interpolation', directive: null, element: null }));
    for (const child of node.children || []) visit(child);
  };
  visit(root);
};

/** Component tags used in a template, as { tag, line } (kebab or Pascal, as written). */
export const collectComponentTags = (root) => {
  const tags = [];
  walkTemplate(root, {
    onElement(element) {
      const isComponent = element.tagType === TAG_TYPE.COMPONENT;
      if (isComponent) tags.push({ tag: element.tag, line: element.loc.start.line });
    }
  });
  return tags;
};
