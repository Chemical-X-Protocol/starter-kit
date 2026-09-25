import * as t from '@babel/types';
import { RULE_REGISTRY } from './rules-registry.js';
import {
  countBranchingDecisions,
  countHookCalls,
  findNestedTernary,
  countDestructuredProps
} from './structural-weight.js';

const isComponentOrHook = (funcPath, relativePath = '') => {
  const isComponentFile = /\.(jsx|tsx|vue|svelte)$/.test(relativePath) ||
    relativePath.includes('/components/') ||
    relativePath.includes('/molecules/') ||
    relativePath.includes('/atoms/') ||
    relativePath.includes('/organisms/') ||
    relativePath.includes('/views/') ||
    relativePath.includes('/hooks/') ||
    relativePath.includes('/composables/');

  if (isComponentFile) return true;

  const id = funcPath.node.id;
  if (id && t.isIdentifier(id)) {
    if (/^[A-Z]/.test(id.name) || /^use[A-Z0-9]/.test(id.name)) {
      return true;
    }
  }

  let returnsJsx = false;
  funcPath.traverse({
    ReturnStatement(ret) {
      if (ret.getFunctionParent() === funcPath) {
        const arg = ret.node.argument;
        if (t.isJSXElement(arg) || t.isJSXFragment(arg)) {
          returnsJsx = true;
        }
      }
    }
  });

  return returnsJsx;
};

export const evaluateComponentStructuralWeight = ({
  funcPath,
  relativePath,
  violations,
  config = {}
}) => {
  if (!isComponentOrHook(funcPath, relativePath)) return null;

  const maxComplexity = config.maxCyclomaticComplexity || 12;
  const maxHooks = config.maxHookDensity || 4;
  const maxProps = config.maxPropCount || 7;

  const complexity = countBranchingDecisions(funcPath);
  const hooks = countHookCalls(funcPath);
  const propCount = countDestructuredProps(funcPath);
  const startLoc = funcPath.node.loc?.start;
  const line = startLoc?.line || 1;
  const column = startLoc?.column || 1;

  if (complexity > maxComplexity) {
    const meta = RULE_REGISTRY.COMPLEXITY_CYCLOMATIC_HIGH;
    violations.push({
      filePath: relativePath,
      line,
      column,
      hazard: `High cyclomatic complexity (${complexity} > ${maxComplexity} threshold)`,
      rule: 'COMPLEXITY_CYCLOMATIC_HIGH',
      severity: meta.severity,
      pillar: meta.pillar,
      directive: meta.directive
    });
  }

  if (hooks > maxHooks) {
    const meta = RULE_REGISTRY.HOOK_STATE_SATURATION;
    violations.push({
      filePath: relativePath,
      line,
      column,
      hazard: `Excessive hook & state density (${hooks} hooks > ${maxHooks} threshold)`,
      rule: 'HOOK_STATE_SATURATION',
      severity: meta.severity,
      pillar: meta.pillar,
      directive: meta.directive
    });
  }

  if (propCount > maxProps) {
    const meta = RULE_REGISTRY.PROP_SURFACE_BLOAT;
    violations.push({
      filePath: relativePath,
      line,
      column,
      hazard: `Prop surface area bloat (${propCount} props > ${maxProps} threshold)`,
      rule: 'PROP_SURFACE_BLOAT',
      severity: meta.severity,
      pillar: meta.pillar,
      directive: meta.directive
    });
  }

  const nestedTernary = findNestedTernary(funcPath);
  if (nestedTernary) {
    const meta = RULE_REGISTRY.CONTROL_FLOW_NESTED_TERNARY;
    violations.push({
      filePath: relativePath,
      line: nestedTernary.loc?.start.line || line,
      column: nestedTernary.loc?.start.column || column,
      hazard: 'Nested ternary expression detected in component logic',
      rule: 'CONTROL_FLOW_NESTED_TERNARY',
      severity: meta.severity,
      pillar: meta.pillar,
      directive: meta.directive
    });
  }

  return { complexity, hooks, propCount };
};
