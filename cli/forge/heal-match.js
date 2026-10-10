// Matches a member site against the piece, node by node, to find each call's arguments (engine doc,
// Heal: "Arguments are each site's verbatim source slices"). A piece parameter matches any site
// expression, whose source slice becomes the argument; every other node must be equal, piece-local
// binders may be renamed consistently, and an unused catch binder may differ or be absent. An argument
// that is not side-effect free refuses: the call evaluates it before the piece runs, the site did not.
import { HealError, parseModuleText } from './heal-text.js';

const SKIPPED_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens']);
const FUNCTION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);

// Node treats these encoding names as one encoding.
const ENCODING_ALIASES = new Map([['utf8', 'utf-8'], ['utf-8', 'utf-8']]);

const MATCH = Object.freeze({ ok: true });
const mismatch = (reason) => ({ ok: false, reason });

const isNode = (value) => Boolean(value) && typeof value === 'object' && typeof value.type === 'string';

const childrenOf = (node) => Object.entries(node).filter(([key]) => !SKIPPED_KEYS.has(key)).flatMap(([, value]) => (Array.isArray(value) ? value : [value])).filter(isNode);

const declaredFunctionOf = (statement, name) => {
  const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : null;
  const isVariable = declaration?.type === 'VariableDeclaration';
  const declarator = isVariable ? declaration.declarations.find((entry) => entry.id.name === name) : null;
  const isNamedFunction = declaration?.type === 'FunctionDeclaration' && declaration.id.name === name;
  return declarator?.init ?? (isNamedFunction ? declaration : null);
};

const exportedFunctionOf = (ast, name) => ast.program.body.map((statement) => declaredFunctionOf(statement, name)).find(Boolean) ?? null;

const collectBinders = (node, names = new Set()) => {
  const isDeclarator = node.type === 'VariableDeclarator' && node.id.type === 'Identifier';
  if (isDeclarator) names.add(node.id.name);
  const isCatchBinder = node.type === 'CatchClause' && node.param?.type === 'Identifier';
  if (isCatchBinder) names.add(node.param.name);
  for (const child of childrenOf(node)) collectBinders(child, names);
  return names;
};

const shapeProblemOf = (fn, name) => {
  const isFunction = Boolean(fn) && FUNCTION_TYPES.has(fn.type);
  const isBlock = isFunction && fn.body.type === 'BlockStatement';
  const problems = [
    [!isFunction, `the piece does not export a function named ${name}`],
    [isFunction && !fn.params.every((param) => param.type === 'Identifier'), `${name} has destructured or default parameters; the matcher needs plain ones`],
    [isBlock && fn.body.body.length !== 1, `${name} has more than one statement; a site matches a one-statement piece`]
  ];
  return problems.find(([isProblem]) => isProblem)?.[1] ?? null;
};

/**
 * The piece's exported function and its core: { params, core: { kind: 'stmt'|'expr', node }, locals }.
 * A block body must hold exactly one statement. Refuses with HEAL_PIECE_SHAPE otherwise.
 */
export const pieceCoreOf = (pieceText, name, file) => {
  const ast = parseModuleText(pieceText, file);
  const fn = exportedFunctionOf(ast, name);
  const problem = shapeProblemOf(fn, name);
  if (problem) throw new HealError('HEAL_PIECE_SHAPE', problem);
  const isBlock = fn.body.type === 'BlockStatement';
  const core = isBlock ? { kind: 'stmt', node: fn.body.body[0] } : { kind: 'expr', node: fn.body };
  return { params: fn.params.map((param) => param.name), core, locals: collectBinders(core.node), text: pieceText };
};

const usesName = (node, name) => {
  const isUse = node.type === 'Identifier' && node.name === name;
  return isUse || childrenOf(node).some((child) => usesName(child, name));
};

const normalizedLiteral = (node) => (node.type === 'StringLiteral' ? ENCODING_ALIASES.get(node.value) ?? node.value : node.value);

const isUnusedBinder = (clause) => !clause.param || !usesName(clause.body, clause.param.name);

const matchCatchBinders = (piece, site, state) => {
  const isPlain = [piece.param, site.param].every((param) => param === null || param.type === 'Identifier');
  if (!isPlain) return mismatch('a catch binder is a pattern');
  const isBothUnused = isUnusedBinder(piece) && isUnusedBinder(site);
  if (isBothUnused) return MATCH;
  const isBothNamed = Boolean(piece.param) && Boolean(site.param);
  if (!isBothNamed) return mismatch('one catch uses its error and the other has none');
  state.renames.set(piece.param.name, site.param.name);
  return MATCH;
};

const bindParam = (piece, site, state) => {
  const slice = state.siteText.slice(site.start, site.end);
  const known = state.args.get(piece.name);
  const isConflict = known !== undefined && known !== slice;
  if (isConflict) return mismatch(`parameter ${piece.name} stands for two different expressions (${known}, ${slice})`);
  const readsSiteBinder = [...state.siteBinders].some((name) => usesName(site, name));
  if (readsSiteBinder) return mismatch(`argument ${slice} reads a name the site itself binds, which the call site cannot see`);
  state.args.set(piece.name, slice);
  state.argNodes.set(piece.name, site);
  return MATCH;
};

const matchIdentifier = (piece, site, state) => {
  const isLocal = state.locals.has(piece.name);
  const renamed = state.renames.get(piece.name);
  const isFirstLocal = isLocal && renamed === undefined;
  if (isFirstLocal) state.renames.set(piece.name, site.name);
  const expected = isLocal ? state.renames.get(piece.name) : piece.name;
  return expected === site.name ? MATCH : mismatch(`${site.name} where the piece has ${piece.name}`);
};

const firstFailure = (pairs, state) => {
  for (const [piece, site] of pairs) {
    const result = matchValue(piece, site, state);
    const isFailed = !result.ok;
    if (isFailed) return result;
  }
  return MATCH;
};

const matchArrays = (piece, site, state) => {
  const isSameLength = Array.isArray(site) && piece.length === site.length;
  return isSameLength ? firstFailure(piece.map((child, index) => [child, site[index]]), state) : mismatch('a list has a different length');
};

const matchChildren = (piece, site, state) => firstFailure(Object.keys(piece).filter((key) => !SKIPPED_KEYS.has(key) && key !== 'param').map((key) => [piece[key], site[key]]), state);

const matchCatch = (piece, site, state) => {
  const binders = matchCatchBinders(piece, site, state);
  return binders.ok ? matchValue(piece.body, site.body, state) : binders;
};

const matchLiteral = (piece, site) => (normalizedLiteral(piece) === normalizedLiteral(site) ? MATCH : mismatch(`literal ${JSON.stringify(site.value)} where the piece has ${JSON.stringify(piece.value)}`));

const matchPrimitive = (piece, site) => {
  const isEqual = piece === site || (piece == null && site == null);
  return isEqual ? MATCH : mismatch(`${String(site)} where the piece has ${String(piece)}`);
};

const NODE_MATCHERS = { Identifier: matchIdentifier, CatchClause: matchCatch };

const matchNode = (piece, site, state) => {
  const isSameType = isNode(site) && site.type === piece.type;
  if (!isSameType) return mismatch(`${site?.type ?? 'nothing'} where the piece has ${piece.type}`);
  const isLiteral = piece.type.endsWith('Literal') && 'value' in piece;
  const matcher = isLiteral ? matchLiteral : NODE_MATCHERS[piece.type] ?? matchChildren;
  return matcher(piece, site, state);
};

function matchValue(piece, site, state) {
  const isList = Array.isArray(piece);
  if (isList) return matchArrays(piece, site, state);
  const isPrimitive = !isNode(piece);
  if (isPrimitive) return matchPrimitive(piece, site);
  const isParam = piece.type === 'Identifier' && state.params.has(piece.name);
  const isBindable = isParam && isNode(site);
  if (isBindable) return bindParam(piece, site, state);
  return isParam ? mismatch(`no expression for ${piece.name}`) : matchNode(piece, site, state);
}

const PURE_LEAVES = new Set(['Identifier', 'StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral', 'BigIntLiteral']);
const PURE_UNARY = new Set(['-', '+', '!', 'void']);

const isPureProperty = (property) => property.type === 'ObjectProperty' && !property.computed && isPureArgument(property.value);

const PURE_COMPOSITES = {
  TemplateLiteral: (node) => node.expressions.every(isPureArgument),
  ArrayExpression: (node) => node.elements.every((element) => element !== null && isPureArgument(element)),
  UnaryExpression: (node) => PURE_UNARY.has(node.operator) && isPureArgument(node.argument),
  ObjectExpression: (node) => node.properties.every(isPureProperty)
};

/** True for an expression with no side effects that cannot throw: literals, names, plain object/array literals. */
export function isPureArgument(node) {
  const isLeaf = PURE_LEAVES.has(node.type);
  return isLeaf || Boolean(PURE_COMPOSITES[node.type]?.(node));
}

/**
 * Matches one site node to the piece core. Returns { ok: true, args: [slice per parameter] } or
 * { ok: false, reason }.
 */
export const matchSite = (piece, siteNode, siteText) => {
  const state = { params: new Set(piece.params), locals: piece.locals, siteBinders: collectBinders(siteNode), renames: new Map(), args: new Map(), argNodes: new Map(), siteText };
  const result = matchValue(piece.core.node, siteNode, state);
  const isMismatch = !result.ok;
  if (isMismatch) return result;
  const unbound = piece.params.filter((param) => !state.args.has(param));
  const hasUnbound = unbound.length > 0;
  if (hasUnbound) return mismatch(`the site has no counterpart for parameter ${unbound.join(', ')}`);
  const impure = piece.params.filter((param) => !isPureArgument(state.argNodes.get(param)));
  const hasImpure = impure.length > 0;
  if (hasImpure) return mismatch(`argument ${impure.map((param) => state.args.get(param)).join(', ')} is not side-effect free; the call would evaluate it before the piece runs (behaviorDelta)`);
  return { ok: true, args: piece.params.map((param) => state.args.get(param)) };
};

const RETURN_RULES = {
  ReturnStatement: () => true,
  BlockStatement: (node) => alwaysReturns(node.body[node.body.length - 1]),
  IfStatement: (node) => alwaysReturns(node.consequent) && alwaysReturns(node.alternate),
  TryStatement: (node) => !node.finalizer && alwaysReturns(node.block) && (!node.handler || alwaysReturns(node.handler.body))
};

/** True when every path through a statement ends in a return (so `return piece(...)` is equivalent). */
export function alwaysReturns(node) {
  const rule = node ? RETURN_RULES[node.type] : null;
  return Boolean(rule) && rule(node);
}

/** The call that replaces a site: an expression, or `return name(args);` for a returning statement. */
export const renderCall = (name, args, { kind, negated = false }) => {
  const call = `${negated ? '!' : ''}${name}(${args.join(', ')})`;
  return kind === 'stmt' ? `return ${call};` : call;
};
