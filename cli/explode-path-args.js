/**
 * Where a source holds paths relative to its own file: module specifiers, import()/require(),
 * TS import types, `new URL(x, import.meta.url)`, import.meta.glob/resolve, require.resolve and
 * test-runner mocks. explode rewrites the literal ones and refuses the computed ones.
 */
const NEGATION_REGEX = /^!/;
export const isRelative = (value) => typeof value === 'string' && (value === '.' || value === '..' || value.startsWith('./') || value.startsWith('../'));
const isStringNode = (node) => node?.type === 'StringLiteral' || (node?.type === 'Literal' && typeof node.value === 'string');
const isMetaProperty = (node) => node?.type === 'MetaProperty' && node.meta?.name === 'import';
const memberName = (node) => node?.property?.name ?? node?.property?.value;

const META_PATH_CALLS = new Set(['glob', 'globEager', 'resolve']);
const MOCK_OBJECTS = new Set(['vi', 'jest', 'vitest']);
const MOCK_CALLS = new Set(['mock', 'doMock', 'unmock', 'doUnmock', 'requireActual', 'importActual', 'requireMock', 'importMock']);

const pathCallArgs = (node) => {
  const callee = node.callee;
  const isMember = callee?.type === 'MemberExpression';
  const isMetaCall = isMember && isMetaProperty(callee.object) && META_PATH_CALLS.has(memberName(callee));
  const isRequireResolve = isMember && callee.object?.name === 'require' && memberName(callee) === 'resolve';
  const isMockCall = isMember && MOCK_OBJECTS.has(callee.object?.name) && MOCK_CALLS.has(memberName(callee));
  const isPathCall = isMetaCall || isRequireResolve || isMockCall;
  if (!isPathCall) return [];
  const first = node.arguments?.[0];
  const isArray = first?.type === 'ArrayExpression';
  return isArray ? first.elements : [first];
};

const isUrlFromImportMeta = (node) => {
  const base = node.arguments?.[1];
  const isMetaUrl = base?.type === 'MemberExpression' && isMetaProperty(base.object) && memberName(base) === 'url';
  return node.callee?.type === 'Identifier' && node.callee.name === 'URL' && isMetaUrl;
};

/**
 * Nodes that hold a path relative to the file: module sources, import()/require(), TS import
 * types, `new URL(x, import.meta.url)`, import.meta.glob/resolve, require.resolve and test mocks.
 */
const pathArgsOf = (node) => {
  const hasSource = node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'ImportExpression';
  if (hasSource) return [node.source];
  const isCall = node.type === 'CallExpression';
  const isImportCall = isCall && node.callee?.type === 'Import';
  const isRequireCall = isCall && node.callee?.type === 'Identifier' && node.callee.name === 'require';
  const isModuleCall = isImportCall || isRequireCall;
  if (isModuleCall) return [node.arguments?.[0]];
  if (isCall) return pathCallArgs(node);
  const isNewUrl = node.type === 'NewExpression' && isUrlFromImportMeta(node);
  if (isNewUrl) return [node.arguments[0]];
  const isImportType = node.type === 'TSImportType';
  if (isImportType) return [node.argument?.literal || node.argument];
  const isImportEquals = node.type === 'TSExternalModuleReference';
  if (isImportEquals) return [node.expression];
  return [];
};

const leadingText = (node) => {
  const isTemplate = node?.type === 'TemplateLiteral';
  if (isTemplate) return node.quasis[0]?.value?.cooked ?? '';
  const isConcat = node?.type === 'BinaryExpression' && node.operator === '+';
  if (isConcat) return isStringNode(node.left) ? node.left.value : leadingText(node.left);
  return '';
};

const walkPathArgs = (root, visit) => {
  const walk = (node) => {
    const isNode = node && typeof node.type === 'string';
    if (!isNode) return;
    pathArgsOf(node).filter(Boolean).forEach(visit);
    for (const [key, child] of Object.entries(node)) {
      const isMeta = key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments';
      if (isMeta) continue;
      const children = Array.isArray(child) ? child : [child];
      children.forEach((c) => walk(c));
    }
  };
  walk(root);
};

/**
 * Every relative path under an AST node, as absolute offsets of the string literal. A glob
 * negation (`'!./x'`) keeps its `!` as `prefix`; `value` is the path itself.
 *
 * @param {object} root Babel node.
 * @returns {{ start: number, end: number, value: string, prefix: string }[]}
 */
export const relativeSpecifiers = (root) => {
  const found = [];
  walkPathArgs(root, (arg) => {
    const isString = isStringNode(arg);
    const prefix = isString && NEGATION_REGEX.test(arg.value) ? '!' : '';
    const value = isString ? arg.value.slice(prefix.length) : null;
    const isRelativePath = isString && isRelative(value);
    if (isRelativePath) found.push({ start: arg.start, end: arg.end, value, prefix });
  });
  return found.sort((a, b) => a.start - b.start);
};

/**
 * Relative paths explode cannot rewrite: template literals or concatenations that start with
 * './' or '../' in a path position. Moving such code would silently change what it resolves to.
 *
 * @param {object} root Babel node.
 * @returns {string[]} Source snippets.
 */
export const unrelocatableSpecifiers = (root, content) => {
  const found = [];
  walkPathArgs(root, (arg) => {
    const isComputed = !isStringNode(arg);
    const isRelativeLead = isComputed && isRelative(leadingText(arg).replace(NEGATION_REGEX, ''));
    if (isRelativeLead) found.push(content.slice(arg.start, arg.end));
  });
  return found;
};

