/**
 * Chemical X Protocol: Diagnostic Multi-Rule Validator & Lazy Rule Tree (CLI / Node Runtime)
 */

export const createRuleSet = (rules) => {
  const entries = Object.entries(rules);

  return (item) => {
    for (const [key, predicate] of entries) {
      const isInvalid = !predicate(item);
      if (isInvalid) {
        return { isValid: false, failingKey: key };
      }
    }
    return { isValid: true, failingKey: null };
  };
};

export const ruleTree = (input, options = {}) => {
  const isFailFast = options.failFast ?? false;
  const violations = [];
  const treeResult = {};

  for (const [scope, branch] of Object.entries(input)) {
    const branchResult = {};
    treeResult[scope] = branchResult;

    for (const [key, test] of Object.entries(branch)) {
      const isFailed = typeof test === 'function' ? Boolean(test()) : Boolean(test);
      branchResult[key] = isFailed;

      if (isFailed) {
        const fullKey = `${scope}.${key}`;
        violations.push(fullKey);
        if (isFailFast) break;
      }
    }
    const hasViolations = violations.length > 0;
    const shouldBreakScope = isFailFast && hasViolations;
    if (shouldBreakScope) break;
  }

  const hasNoViolations = violations.length === 0;
  return {
    ok: hasNoViolations,
    first: violations[0] ?? null,
    violations,
    tree: treeResult
  };
};

export const evaluateRules = (rules, options = {}) => {
  const isFailFast = options.failFast ?? false;
  const violations = [];

  for (const [key, test] of Object.entries(rules)) {
    const isFailed = typeof test === 'function' ? Boolean(test()) : Boolean(test);
    if (isFailed) {
      violations.push(key);
      if (isFailFast) break;
    }
  }

  const hasNoViolations = violations.length === 0;
  return {
    ok: hasNoViolations,
    first: violations[0] ?? null,
    violations
  };
};

export const assertRuleTree = (input, onFail) => {
  const result = ruleTree(input, { failFast: true });
  const hasCallback = Boolean(onFail);
  const hasFirstViolation = Boolean(result.first);
  const shouldNotifyFailure = !result.ok && hasCallback && hasFirstViolation;
  if (shouldNotifyFailure) {
    onFail(result.first);
  }
  return result.ok;
};
