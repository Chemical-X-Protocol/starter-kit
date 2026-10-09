/**
 * RENDER_TREE_DEPTH_EXCEEDED (AGENTS.md 1.A: max render tree depth per profile).
 * Depth counts nested conditional or list rendering: v-if / v-else-if / v-else /
 * v-for in Vue templates, and conditional, logical or .map() expression containers
 * in JSX. Reported once, at the first element that crosses the limit.
 */
import * as t from '@babel/types';
import { RULE_REGISTRY } from './rules-registry.js';
import { NODE } from '../sfc/template-walk.js';

const CONTROL_DIRECTIVES = new Set(['if', 'else-if', 'else', 'for']);
const DEFAULT_MAX_RENDER_DEPTH = 4;

const buildViolation = (relativePath, line, column, depth, limit) => {
  const meta = RULE_REGISTRY.RENDER_TREE_DEPTH_EXCEEDED;
  return {
    filePath: relativePath,
    line,
    column,
    hazard: `Render tree depth ${depth} exceeds ${limit} nested conditional/list levels`,
    rule: 'RENDER_TREE_DEPTH_EXCEEDED',
    severity: meta.severity,
    pillar: meta.pillar,
    directive: meta.directive
  };
};

export const resolveMaxRenderDepth = (config = {}) => config.maxRenderDepth || DEFAULT_MAX_RENDER_DEPTH;

const isControlElement = (node) => node.type === NODE.ELEMENT &&
  (node.props || []).some((p) => p.type === NODE.DIRECTIVE && CONTROL_DIRECTIVES.has(p.name));

/** Vue template render depth; returns violations. */
export const checkTemplateRenderDepth = (template, relativePath, config) => {
  const limit = resolveMaxRenderDepth(config);
  const violations = [];
  const visit = (node, depth) => {
    const nextDepth = isControlElement(node) ? depth + 1 : depth;
    const crossesLimit = nextDepth > limit && depth <= limit;
    if (crossesLimit) violations.push(buildViolation(relativePath, node.loc.start.line, node.loc.start.column, nextDepth, limit));
    if (crossesLimit) return;
    for (const child of node.children || []) visit(child, nextDepth);
  };
  if (template?.ast) visit(template.ast, 0);
  return violations;
};

const isRenderBranch = (container) => {
  const expr = container.expression;
  const isMapCall = t.isCallExpression(expr) && t.isMemberExpression(expr.callee) && t.isIdentifier(expr.callee.property, { name: 'map' });
  return t.isConditionalExpression(expr) || t.isLogicalExpression(expr) || isMapCall;
};

const isRenderCallback = (fnPath) => fnPath.parentPath?.isCallExpression() &&
  Boolean(fnPath.findParent((p) => p.isJSXExpressionContainer()));

/** JSX visitor: counts render-branch containers between an element and its function. */
export const createJsxRenderDepthVisitor = ({ relativePath, violations, config }) => {
  const limit = resolveMaxRenderDepth(config);
  return {
    JSXExpressionContainer(astPath) {
      if (!isRenderBranch(astPath.node)) return;
      let depth = 1;
      let current = astPath.parentPath;
      const isComponentBoundary = (p) => p.isFunction() && !isRenderCallback(p);
      while (current && !isComponentBoundary(current)) {
        const isBranchAncestor = current.isJSXExpressionContainer() && isRenderBranch(current.node);
        if (isBranchAncestor) depth += 1;
        current = current.parentPath;
      }
      const isFirstOverLimit = depth === limit + 1;
      if (isFirstOverLimit) {
        const loc = astPath.node.loc?.start;
        violations.push(buildViolation(relativePath, loc?.line || 1, loc?.column || 1, depth, limit));
      }
    }
  };
};
