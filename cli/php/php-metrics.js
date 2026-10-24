// PHP complexity and nesting rules (design spec section 4). Passes are (ctx) => void and
// report through ctx.report only. Counting is syntactic: it does not follow calls or
// understand what a branch does, so a high count means "worth a look", not "wrong".
import { walk, walkScope } from './php-walk.js';

const FUNCTION_KINDS = new Set(['function', 'method', 'closure', 'arrowfunc']);
const OWN_BRANCH_KINDS = new Set(['if', 'retif', 'for', 'foreach', 'while', 'do', 'catch']);
const LOGICAL_OPERATORS = new Set(['&&', '||', 'and', 'or', '??']);
const NESTING_KINDS = new Set(['if', 'while', 'for', 'foreach', 'do', 'switch', 'catch']);
const METADATA_KEYS = new Set(['loc', 'parent', 'leadingComments', 'trailingComments']);
const DEFAULT_MAX_COMPLEXITY = 12;
const WEIGHT_DEPTH_LIMIT = 4;

export const RULE_DEFAULTS = {
  COMPLEXITY_CYCLOMATIC_HIGH: { defaultOn: true, corpus: '10/12', heldOut: 'held up (spec 2.4)', measured: '2026-10-24' },
  STRUCTURAL_WEIGHT_EXCEEDED: { defaultOn: true, corpus: '10/10', heldOut: 'held up (spec 2.4)', measured: '2026-10-24' },
};

const EXTRA_WEIGHT = {
  case: (node) => Number(Boolean(node.test)),
  matcharm: (node) => (node.conds || []).length,
  bin: (node) => Number(LOGICAL_OPERATORS.has(node.type)),
};

function branchWeight(node) {
  if (OWN_BRANCH_KINDS.has(node.kind)) return 1;
  const weigh = EXTRA_WEIGHT[node.kind];
  return weigh ? weigh(node) : 0;
}

/** 1 plus every decision point in the function's own body (nested functions are their own scope). */
export function cyclomaticComplexity(fn) {
  let total = 1;
  walkScope(fn, (node) => {
    total += branchWeight(node);
  });
  return total;
}

function isNodeLike(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.kind === 'string';
}

function stopsDepthScan(node) {
  return FUNCTION_KINDS.has(node.kind) || node.kind === 'class';
}

function keepsParentDepth(parent, key, child) {
  const isIfTest = parent.kind === 'if' && key === 'test';
  const isElseIfBranch = parent.kind === 'if' && key === 'alternate' && isNodeLike(child) && child.kind === 'if';
  return isIfTest || isElseIfBranch;
}

/**
 * Braced control nesting depth of a function body. An elseif is a sibling of the if that
 * opened the chain, so it adds no depth of its own; nested functions are not entered. Alternative syntax
 * (`if: endif;`) counts like braces: the parsed tree does not distinguish them here.
 */
export function controlDepth(fn) {
  let max = 0;
  const visit = (node, depth) => {
    const children = Array.isArray(node) ? node : [node];
    for (const item of children.filter(isNodeLike)) {
      const isBoundary = stopsDepthScan(item);
      if (isBoundary) continue;
      const opens = NESTING_KINDS.has(item.kind);
      const inner = opens ? depth + 1 : depth;
      max = Math.max(max, inner);
      descend(item, depth, inner);
    }
  };
  const descend = (node, depth, inner) => {
    for (const [key, child] of Object.entries(node)) {
      if (METADATA_KEYS.has(key)) continue;
      visit(child, keepsParentDepth(node, key, child) ? depth : inner);
    }
  };
  visit(fn.body, 0);
  return max;
}

function textOf(value) {
  const text = typeof value === 'string' ? value : value && value.name;
  return typeof text === 'string' ? text : '';
}

function functionLabel(node) {
  const name = textOf(node.name);
  return name ? `${node.kind} ${name}` : node.kind;
}

function configuredMax(ctx) {
  const rules = (ctx.config && ctx.config.rules) || {};
  return Number(rules.maxCyclomaticComplexity) > 0 ? Number(rules.maxCyclomaticComplexity) : DEFAULT_MAX_COMPLEXITY;
}

function eachFunction(ctx, handler) {
  walk(ctx.ast, (node) => {
    const isFunction = FUNCTION_KINDS.has(node.kind);
    if (isFunction) handler(node);
  });
}

export function complexityPass(ctx) {
  const limit = configuredMax(ctx);
  eachFunction(ctx, (fn) => {
    const count = cyclomaticComplexity(fn);
    const isTooComplex = count > limit;
    if (!isTooComplex) return;
    ctx.report('COMPLEXITY_CYCLOMATIC_HIGH', fn,
      `Cyclomatic complexity ${count} > ${limit} in ${functionLabel(fn)}. Split the branches into named helpers.`,
      { severity: 'MEDIUM' });
  });
}

export function structuralWeightPass(ctx) {
  eachFunction(ctx, (fn) => {
    const depth = controlDepth(fn);
    const isTooDeep = depth >= WEIGHT_DEPTH_LIMIT;
    if (!isTooDeep) return;
    ctx.report('STRUCTURAL_WEIGHT_EXCEEDED', fn,
      `Control nesting depth ${depth} >= ${WEIGHT_DEPTH_LIMIT} in ${functionLabel(fn)}. Flatten with early exits or extract the inner block.`,
      { severity: 'MEDIUM' });
  });
}

/** The one entry the analyzer registers for this family. */
export function metricsPass(ctx) {
  complexityPass(ctx);
  structuralWeightPass(ctx);
}
