/**
 * Chemical X Protocol: Diagnostic Multi-Rule Validator & Lazy Rule Tree
 * Drop-in hooks/helper for starter-kit applications.
 */

export interface RuleEvaluation<K extends string = string> {
  isValid: boolean;
  failingKey: K | null;
}

export const createRuleSet = <T, K extends string = string>(rules: Record<K, (item: T) => boolean>) => {
  const entries = Object.entries(rules) as Array<[K, (item: T) => boolean]>;

  return (item: T): RuleEvaluation<K> => {
    for (const [key, predicate] of entries) {
      const isInvalid = !predicate(item);
      if (isInvalid) {
        return { isValid: false, failingKey: key };
      }
    }
    return { isValid: true, failingKey: null };
  };
};

export type RuleValue = boolean | (() => boolean);
export type RuleBranch = Record<string, RuleValue>;
export type RuleTreeInput = Record<string, RuleBranch>;

export interface RuleTreeResult<T extends RuleTreeInput> {
  ok: boolean;
  first: string | null;
  violations: string[];
  tree: { [K in keyof T]: { [P in keyof T[K]]: boolean } };
}

export const ruleTree = <T extends RuleTreeInput>(
  input: T,
  options: { failFast?: boolean } = {}
): RuleTreeResult<T> => {
  const isFailFast = options.failFast ?? false;
  const violations: string[] = [];
  const treeResult = {} as RuleTreeResult<T>["tree"];

  for (const [scope, branch] of Object.entries(input)) {
    const branchResult = {} as Record<string, boolean>;
    treeResult[scope as keyof T] = branchResult as any;

    for (const [key, test] of Object.entries(branch)) {
      const isFailed = typeof test === "function" ? Boolean(test()) : Boolean(test);
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

  return {
    ok: violations.length === 0,
    first: violations[0] ?? null,
    violations,
    tree: treeResult
  };
};

export const evaluateRules = <K extends string = string>(
  rules: Record<K, RuleValue>,
  options: { failFast?: boolean } = {}
): { ok: boolean; first: K | null; violations: K[] } => {
  const isFailFast = options.failFast ?? false;
  const violations: K[] = [];

  for (const [key, test] of Object.entries(rules) as [K, RuleValue][]) {
    const isFailed = typeof test === "function" ? Boolean(test()) : Boolean(test);
    if (isFailed) {
      violations.push(key);
      if (isFailFast) break;
    }
  }

  return {
    ok: violations.length === 0,
    first: violations[0] ?? null,
    violations
  };
};

export const assertRuleTree = <T extends RuleTreeInput>(
  input: T,
  onFail?: (firstKey: string) => void
): boolean => {
  const result = ruleTree(input, { failFast: true });
  const hasCallback = Boolean(onFail);
  const hasFirstViolation = Boolean(result.first);
  const shouldNotifyFailure = !result.ok && hasCallback && hasFirstViolation;
  if (shouldNotifyFailure) {
    onFail!(result.first!);
  }
  return result.ok;
};
