/**
 * Chemical X Protocol: Canonical Predicates for AST & CLI Control Flow
 * Reusable single-concept booleans and higher-order predicate helpers.
 */

const COMPONENT_PATH_SEGMENTS = ['molecules', 'components', '/m-', '/views/', '/pages/'];
const COMPONENT_EXTENSIONS = new Set(['.vue', '.tsx', '.jsx']);
const TEMPLATE_EXTENSIONS = new Set(['.vue', '.html', '.svelte']);
const COMMENT_PREFIXES = ['//', '*', '/*'];
const CONSOLE_LOG_METHODS = ['log', 'info', 'warn'];
const NON_INTERACTIVE_FLAGS = ['--non-interactive', '--no-interactive', '--ci', '--headless', '--yes', '-y'];
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
  const isNotTTY = Boolean(process.stdout && process.stdout.isTTY === false);
  return [hasCliFlag, hasOutputFlag, hasFormatFlag, hasCiEnv, isNotTTY].some(Boolean);
};

const EXEMPT_TEST_PATTERNS = [
  /abort/i,
  /signal/i,
  /mounted/i,
  /unmount/i,
  /destroy/i,
  /cleanup/i,
  /timer/i,
  /timeout/i,
  /interval/i,
  /debounce/i,
  /throttle/i,
  /\bon[A-Z]/,
  /\bcall(?:back|backFn)?\b/i,
  /\bcb\b/i,
  /\bhandler\b/i
];

const MUTATING_FUNCTION_PATTERNS = [
  /^handle[A-Z]/,
  /^on[A-Z]/,
  /^(?:save|update|delete|remove|create|add|insert|post|send|process|submit|dispatch|execute|mutate|checkout|charge|sync|write)/i
];

const PURE_PREDICATE_PATTERNS = [
  /^(?:is|has|can|should|check)[A-Z]/
];

const isDiagnosticOrErrorStatement = (stmt, t) => {
  if (t.isThrowStatement(stmt)) return true;
  if (t.isExpressionStatement(stmt)) {
    const expr = stmt.expression;
    if (t.isCallExpression(expr)) {
      const callee = expr.callee;
      if (t.isMemberExpression(callee)) {
        const objName = t.isIdentifier(callee.object) ? callee.object.name : '';
        const propName = t.isIdentifier(callee.property) ? callee.property.name : '';
        if (['console', 'logger', 'log'].includes(objName)) return true;
        if (/^(?:error|warn|info|trace|notify|alert)/i.test(propName)) return true;
      }
      if (t.isIdentifier(callee) && /^(?:report|notify|alert|set.*Error|handleError)/i.test(callee.name)) return true;
    }
    if (t.isAssignmentExpression(expr)) {
      const left = expr.left;
      if (t.isMemberExpression(left) && t.isIdentifier(left.property) && /error/i.test(left.property.name)) return true;
      if (t.isIdentifier(left) && /error/i.test(left.name)) return true;
    }
  }
  return false;
};

export const isSilentGuardClause = (ifPath, t) => {
  const node = ifPath.node;
  if (!node || node.alternate) return false;

  let hasBareReturn = false;
  let hasDiagnosticOrHandling = false;

  const checkStatement = (stmt) => {
    if (t.isReturnStatement(stmt)) {
      const isBare = !stmt.argument || (t.isIdentifier(stmt.argument) && stmt.argument.name === 'undefined');
      if (isBare) hasBareReturn = true;
    } else if (isDiagnosticOrErrorStatement(stmt, t)) {
      hasDiagnosticOrHandling = true;
    }
  };

  if (t.isReturnStatement(node.consequent)) {
    checkStatement(node.consequent);
  } else if (t.isBlockStatement(node.consequent)) {
    for (const stmt of node.consequent.body) {
      checkStatement(stmt);
    }
  }

  if (!hasBareReturn || hasDiagnosticOrHandling) return false;

  const collectTestIdentifiers = (n) => {
    const names = [];
    const walk = (item) => {
      if (!item) return;
      if (t.isIdentifier(item)) {
        names.push(item.name);
      } else if (t.isMemberExpression(item)) {
        walk(item.object);
        walk(item.property);
      } else if (t.isUnaryExpression(item)) {
        walk(item.argument);
      } else if (t.isLogicalExpression(item) || t.isBinaryExpression(item)) {
        walk(item.left);
        walk(item.right);
      } else if (t.isCallExpression(item)) {
        walk(item.callee);
        for (const arg of item.arguments) walk(arg);
      }
    };
    walk(n);
    return names;
  };

  const testIdentifiers = collectTestIdentifiers(node.test);
  const isExemptTest = testIdentifiers.some((name) => EXEMPT_TEST_PATTERNS.some((pat) => pat.test(name)));
  if (isExemptTest) return false;

  const funcParent = ifPath.getFunctionParent();
  if (!funcParent) return false;

  let funcName = '';
  if (funcParent.node.id?.name) {
    funcName = funcParent.node.id.name;
  } else if (funcParent.parentPath?.isVariableDeclarator() && t.isIdentifier(funcParent.parentPath.node.id)) {
    funcName = funcParent.parentPath.node.id.name;
  } else if (t.isIdentifier(funcParent.node.key)) {
    funcName = funcParent.node.key.name;
  }

  const isAsync = Boolean(funcParent.node.async);
  const isMutatingName = MUTATING_FUNCTION_PATTERNS.some((pat) => pat.test(funcName));
  const isPurePredicate = PURE_PREDICATE_PATTERNS.some((pat) => pat.test(funcName));

  if (isPurePredicate && !isAsync && !isMutatingName) return false;

  const isTargetFunction = isAsync || isMutatingName;
  if (!isTargetFunction) return false;

  return { funcName: funcName || (isAsync ? 'async operation' : 'command handler') };
};

export const isSwallowedCatch = (astPath, t) => {
  const body = astPath.node.body?.body || [];
  if (body.length === 0) return true;

  const nonNoopStatements = body.filter((stmt) => !t.isEmptyStatement(stmt));
  if (nonNoopStatements.length === 0) return true;

  let hasActiveHandling = false;
  astPath.traverse({
    ThrowStatement() {
      hasActiveHandling = true;
    },
    ReturnStatement(retPath) {
      if (retPath.node.argument !== null) {
        hasActiveHandling = true;
      }
    },
    CallExpression(callPath) {
      const callee = callPath.node.callee;
      if (t.isMemberExpression(callee)) {
        const objName = t.isIdentifier(callee.object) ? callee.object.name : '';
        const propName = t.isIdentifier(callee.property) ? callee.property.name : '';
        const isLogger = ['console', 'logger', 'log', 'telemetry', 'reportError'].includes(objName);
        const isHandlingMethod = ['error', 'warn', 'info', 'captureException', 'track'].includes(propName);
        const isProcessStderr = t.isMemberExpression(callee.object) &&
          t.isIdentifier(callee.object.object, { name: 'process' }) &&
          t.isIdentifier(callee.object.property, { name: 'stderr' });
        if (isLogger || isHandlingMethod || isProcessStderr) {
          hasActiveHandling = true;
        }
      } else if (t.isIdentifier(callee)) {
        const isHandler = ['handleError', 'reportError', 'captureException', 'toResult'].includes(callee.name);
        if (isHandler) {
          hasActiveHandling = true;
        }
      }
    }
  });

  return !hasActiveHandling;
};

export const countOptionalChainingDepth = (node, t) => {
  let count = 0;
  let curr = node;
  while (curr && (t.isOptionalMemberExpression(curr) || t.isOptionalCallExpression(curr) || t.isMemberExpression(curr))) {
    if (curr.optional) {
      count++;
    }
    curr = curr.object || curr.callee;
  }
  return count;
};

const COMBINATOR_NAMES = new Set(['all', 'any', 'none', 'allPass', 'anyPass', 'nonePass']);

export const isCombinatorCall = (callee, t) => {
  if (t.isIdentifier(callee)) {
    return COMBINATOR_NAMES.has(callee.name);
  }
  return false;
};

export const isRawBooleanArg = (arg, t) => {
  if (t.isBinaryExpression(arg)) return true;
  if (t.isLogicalExpression(arg)) return true;
  if (t.isBooleanLiteral(arg)) return true;
  if (t.isUnaryExpression(arg, { operator: '!' })) return true;
  return false;
};

