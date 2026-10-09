import * as t from '@babel/types';

export const countBranchingDecisions = (funcPath) => {
  let complexity = 1;
  const isDirectChild = (p) => p.getFunctionParent() === funcPath;

  funcPath.traverse({
    IfStatement(p) {
      const isDirectDecision = isDirectChild(p);
      if (isDirectDecision) complexity += 1;
    },
    ConditionalExpression(p) {
      const isDirectDecision = isDirectChild(p);
      if (isDirectDecision) complexity += 1;
    },
    SwitchCase(p) {
      const isDirectCase = isDirectChild(p);
      const hasCaseTest = p.node.test !== null;
      const shouldCountCase = isDirectCase && hasCaseTest;
      if (shouldCountCase) complexity += 1;
    },
    LogicalExpression(p) {
      const isDirectDecision = isDirectChild(p);
      if (isDirectDecision) complexity += 1;
    },
    ForStatement(p) {
      const isDirectDecision = isDirectChild(p);
      if (isDirectDecision) complexity += 1;
    },
    ForInStatement(p) {
      const isDirectDecision = isDirectChild(p);
      if (isDirectDecision) complexity += 1;
    },
    ForOfStatement(p) {
      const isDirectDecision = isDirectChild(p);
      if (isDirectDecision) complexity += 1;
    },
    WhileStatement(p) {
      const isDirectDecision = isDirectChild(p);
      if (isDirectDecision) complexity += 1;
    },
    CatchClause(p) {
      const isDirectDecision = isDirectChild(p);
      if (isDirectDecision) complexity += 1;
    }
  });
  return complexity;
};

export const countHookCalls = (funcPath) => {
  let hooks = 0;
  funcPath.traverse({
    CallExpression(p) {
      const isDirectCall = p.getFunctionParent() === funcPath;
      if (!isDirectCall) return;
      const callee = p.node.callee;
      const isHookIdentifier = t.isIdentifier(callee) && /^use[A-Z0-9]/.test(callee.name);
      if (isHookIdentifier) {
        hooks += 1;
      }
    }
  });
  return hooks;
};

export const findNestedTernary = (astPath) => {
  let nested = null;
  astPath.traverse({
    ConditionalExpression(p) {
      const hasNested = Boolean(nested);
      if (hasNested) return;
      const parentCond = p.findParent((parent) => t.isConditionalExpression(parent.node));
      const hasParentCond = Boolean(parentCond);
      if (hasParentCond) {
        nested = p.node;
      }
    }
  });
  return nested;
};

export const countDestructuredProps = (funcPath) => {
  const firstParam = funcPath.node.params?.[0];
  const isObjectPattern = t.isObjectPattern(firstParam);
  if (isObjectPattern) {
    return firstParam.properties.length;
  }
  return 0;
};

export const measureJsxDepth = (jsxElementPath) => {
  let maxDepth = 1;
  const walk = (node, depth) => {
    const exceedsMaxDepth = depth > maxDepth;
    if (exceedsMaxDepth) maxDepth = depth;
    const isJsxContainer = t.isJSXElement(node) || t.isJSXFragment(node);
    if (isJsxContainer) {
      const children = node.children || [];
      for (const child of children) {
        const isChildElement = t.isJSXElement(child) || t.isJSXFragment(child);
        if (isChildElement) {
          walk(child, depth + 1);
        }
      }
    }
  };
  walk(jsxElementPath.node, 1);
  return maxDepth;
};
