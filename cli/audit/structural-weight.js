import * as t from '@babel/types';

export const countBranchingDecisions = (funcPath) => {
  let complexity = 1;
  funcPath.traverse({
    IfStatement(p) {
      if (p.getFunctionParent() === funcPath) complexity += 1;
    },
    ConditionalExpression(p) {
      if (p.getFunctionParent() === funcPath) complexity += 1;
    },
    SwitchCase(p) {
      if (p.getFunctionParent() === funcPath && p.node.test !== null) complexity += 1;
    },
    LogicalExpression(p) {
      if (p.getFunctionParent() === funcPath) complexity += 1;
    },
    ForStatement(p) {
      if (p.getFunctionParent() === funcPath) complexity += 1;
    },
    ForInStatement(p) {
      if (p.getFunctionParent() === funcPath) complexity += 1;
    },
    ForOfStatement(p) {
      if (p.getFunctionParent() === funcPath) complexity += 1;
    },
    WhileStatement(p) {
      if (p.getFunctionParent() === funcPath) complexity += 1;
    },
    CatchClause(p) {
      if (p.getFunctionParent() === funcPath) complexity += 1;
    }
  });
  return complexity;
};

export const countHookCalls = (funcPath) => {
  let hooks = 0;
  funcPath.traverse({
    CallExpression(p) {
      if (p.getFunctionParent() !== funcPath) return;
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
      if (nested) return;
      const parentCond = p.findParent((parent) => t.isConditionalExpression(parent.node));
      if (parentCond) {
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
    if (depth > maxDepth) maxDepth = depth;
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
