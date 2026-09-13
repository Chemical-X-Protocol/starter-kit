/**
 * Chemical X Protocol: Canonical Predicates for AST & CLI Control Flow
 * Reusable single-concept booleans and higher-order predicate helpers.
 */

const COMPONENT_PATH_SEGMENTS = ['molecules', 'components', '/m-', '/views/', '/pages/'];
const COMPONENT_EXTENSIONS = new Set(['.vue', '.tsx', '.jsx']);
const TEMPLATE_EXTENSIONS = new Set(['.vue', '.html', '.svelte']);
const COMMENT_PREFIXES = ['//', '*', '/*'];
const CONSOLE_LOG_METHODS = ['log', 'info', 'warn'];
const NON_INTERACTIVE_FLAGS = ['--non-interactive', '--no-interactive', '--ci'];
const FORMAT_FLAGS = ['--markdown', '--md', '--json'];
const GRADE_RANKS = { 'A+': 5, 'A': 4, 'B': 3, 'C': 2, 'D': 1, 'F': 0 };

export const isComponentPath = (path) => {
  return COMPONENT_PATH_SEGMENTS.some((segment) => path.includes(segment));
};

export const isComponentExtension = (ext) => COMPONENT_EXTENSIONS.has(ext);

export const isTemplateExtension = (ext) => TEMPLATE_EXTENSIONS.has(ext);

export const isCommentLine = (line) => {
  if (!line) return false;
  return COMMENT_PREFIXES.some((prefix) => line.startsWith(prefix));
};

export const isCodeLine = (line) => {
  if (!line) return false;
  const isLineComment = line.startsWith('//');
  const isBlockComment = line.startsWith('/*');
  return !isLineComment && !isBlockComment;
};

export const isConsoleCallStatement = (stmt, t) => {
  if (!t.isExpressionStatement(stmt)) return false;
  const expr = stmt.expression;
  if (!t.isCallExpression(expr)) return false;
  const callee = expr.callee;
  if (!t.isMemberExpression(callee)) return false;
  return t.isIdentifier(callee.object, { name: 'console' });
};

export const isShallowCatchBody = (body, t) => {
  if (body.length === 0) return true;
  if (body.length === 1) return isConsoleCallStatement(body[0], t);
  return false;
};

export const hasAnyTypeAnnotation = (param, t) => {
  if (!param || !t.isIdentifier(param)) return false;
  const typeAnn = param.typeAnnotation;
  if (!typeAnn || !t.isTSTypeAnnotation(typeAnn)) return false;
  return t.isTSAnyKeyword(typeAnn.typeAnnotation);
};

export const isRedundantPassthroughReturn = (curr, next, t) => {
  if (!t.isVariableDeclaration(curr) || curr.declarations.length !== 1) return false;
  const decl = curr.declarations[0];
  if (!t.isIdentifier(decl.id)) return false;
  if (!t.isReturnStatement(next) || !t.isIdentifier(next.argument)) return false;
  return decl.id.name === next.argument.name;
};

export const isHookIdentifier = (idNode) => {
  return Boolean(idNode?.name && /^use[A-Z0-9]/.test(idNode.name));
};

export const isCustomHookFunction = (astPath) => {
  const hasHookId = isHookIdentifier(astPath.node.id);
  const hasParentHookId = isHookIdentifier(astPath.parentPath?.node?.id);
  return hasHookId || hasParentHookId;
};

export const resolveStartLine = (primaryNode, fallbackNode, defaultLine = 1) => {
  const primaryLine = primaryNode?.loc?.start?.line;
  if (primaryLine !== undefined) return primaryLine;
  const fallbackLine = fallbackNode?.loc?.start?.line;
  if (fallbackLine !== undefined) return fallbackLine;
  return defaultLine;
};

export const resolveFirstDefined = (...candidates) => {
  for (const val of candidates) {
    if (val !== null && val !== undefined) return val;
  }
  return undefined;
};

export const hasMatchingAuditMetrics = (a, b) => {
  const isScoreMatch = a.health?.score === b.health?.score;
  if (!isScoreMatch) return false;
  const isLocMatch = a.metrics?.totalLoc === b.metrics?.totalLoc;
  if (!isLocMatch) return false;
  return a.violations?.total === b.violations?.total;
};

export const isZeroDelayTimeout = (callee, delayArg, t) => {
  const isTimeoutId = t.isIdentifier(callee, { name: 'setTimeout' });
  const isZeroNumeric = t.isNumericLiteral(delayArg) && delayArg.value === 0;
  return isTimeoutId && isZeroNumeric;
};

export const isUnguardedConsoleCall = (callee, t) => {
  if (!t.isMemberExpression(callee)) return false;
  if (!t.isIdentifier(callee.object, { name: 'console' })) return false;
  if (!t.isIdentifier(callee.property)) return false;
  return CONSOLE_LOG_METHODS.includes(callee.property.name);
};

export const matchesDiscussionTitle = (titleLower, targetLower) => {
  const patterns = [
    ` ${targetLower} :`,
    ` ${targetLower} [`,
    `: ${targetLower}`,
    `${targetLower} audit`
  ];
  return patterns.some((p) => titleLower.includes(p));
};

export const isGradeBelowMinimum = (currentGrade, minGrade) => {
  if (!minGrade) return false;
  const currentRank = GRADE_RANKS[currentGrade];
  const minRank = GRADE_RANKS[minGrade];
  const hasValidRanks = currentRank !== undefined && minRank !== undefined;
  return hasValidRanks && currentRank < minRank;
};

export const evaluateAuditFailure = (conditions = []) => {
  return conditions.some(Boolean);
};

export const isNonInteractiveSession = (rawArgs, env = process.env) => {
  const hasCliFlag = NON_INTERACTIVE_FLAGS.some((flag) => rawArgs.includes(flag));
  const hasOutputFlag = rawArgs.some((arg) => arg.startsWith('--output=') || arg.startsWith('-o='));
  const hasFormatFlag = FORMAT_FLAGS.some((flag) => rawArgs.includes(flag));
  const hasCiEnv = Boolean(env.CI || env.GIT_DIR);
  return [hasCliFlag, hasOutputFlag, hasFormatFlag, hasCiEnv].some(Boolean);
};
