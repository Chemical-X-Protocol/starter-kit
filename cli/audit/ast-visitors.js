import * as t from '@babel/types';
import { RULE_REGISTRY } from './rules-registry.js';
import {
  isCustomHookFunction,
  resolveStartLine,
  isZeroDelayTimeout,
  isUnguardedConsoleCall,
  isSilentGuardClause,
  countOptionalChainingDepth,
  isCombinatorCall,
  isRawBooleanArg
} from './rules-predicates.js';
import { isSwallowedCatch } from './catch-predicates.js';
import { resolveCatchEscalation, resolveCatchSpan } from './shallow-catch-escalation.js';
import { isNamedCondition, countJunctionOperators, resolveIfChainLength } from './lexicon-predicates.js';
import { collectTeardowns, classifyTimerDisposal, isListenerDisposed } from './lifecycle-predicates.js';
import { validateHookReturnShape } from './hook-shape-validator.js';
import { evaluateComponentStructuralWeight } from './structural-weight-evaluator.js';

const LOOKUP_CHAIN_MIN_BRANCHES = 3;
const MAX_TEMPLATE_JUNCTIONS = 2;
const TIMER_SEVERITY_BY_KIND = { setInterval: 'CRITICAL', setTimeout: 'LOW' };

export const createAstVisitors = ({ relativePath, violations, hookRegistry, config }) => {
  let teardowns = { clearedHandles: new Set(), removedListeners: [] };
  return {
    Program(programPath) {
      teardowns = collectTeardowns(programPath);
    },

    Function(astPath) {
      evaluateComponentStructuralWeight({
        funcPath: astPath,
        relativePath,
        violations,
        config
      });

      const isCustomHook = isCustomHookFunction(astPath);

      // Pillar 3: Hook Saturation
      const CONTROLLER_WRAPPER_EXCLUSIONS = new Set([
        'useSharedStatusController',
        'useSharedController',
        'useController'
      ]);
      let hookCount = 0;
      astPath.traverse({
        CallExpression(callPath) {
          const callee = callPath.node.callee;
          const isHookCall = t.isIdentifier(callee) && /^use[A-Z0-9]/.test(callee.name);
          if (isHookCall) {
            const isExcluded = CONTROLLER_WRAPPER_EXCLUSIONS.has(callee.name);
            const isOwnHookCall = !isExcluded && callPath.getFunctionParent() === astPath;
            if (isOwnHookCall) {
              hookCount += 1;
            }
          }
        }
      });

      const isHookSaturated = hookCount > 5;
      if (isHookSaturated) {
        const line = astPath.node.loc?.start.line || 1;
        const meta = RULE_REGISTRY.HOOK_SATURATION;
        violations.push({
          filePath: relativePath,
          line,
          column: astPath.node.loc?.start.column || 1,
          hazard: `Hook saturation detected (${hookCount} hooks > 5 limit)`,
          rule: 'HOOK_SATURATION',
          severity: meta.severity,
          pillar: meta.pillar,
          directive: meta.directive
        });
      }

      // Pillar 3: Hook Return Overload (3 to 5 limit)
      if (isCustomHook) {
        astPath.traverse({
          ReturnStatement(retPath) {
            const isOwnReturn = retPath.getFunctionParent() === astPath;
            if (isOwnReturn) {
              validateHookReturnShape({
                retPath,
                astPath,
                relativePath,
                violations,
                hookRegistry
              });
            }
          }
        });
      }
    },

    // Pillar 2: Control Flow Complexity
    JSXExpressionContainer(astPath) {
      const expr = astPath.node.expression;
      const isBooleanExpression = t.isLogicalExpression(expr) || t.isUnaryExpression(expr);
      if (isBooleanExpression) {
        const opCount = countJunctionOperators(expr);
        const hasTooManyJunctions = opCount > MAX_TEMPLATE_JUNCTIONS;
        if (hasTooManyJunctions) {
          const line = resolveStartLine(expr, astPath.node, 1);
          const meta = RULE_REGISTRY.CONTROL_FLOW_INLINE_BOOLEAN;
          violations.push({
            filePath: relativePath,
            line,
            column: expr.loc?.start.column || 1,
            hazard: `Inline boolean complexity (${opCount} logical operators > 2 limit)`,
            rule: 'CONTROL_FLOW_INLINE_BOOLEAN',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
        }
      }
    },

    IfStatement(astPath) {
      const expr = astPath.node.test;
      const isLookupChain = resolveIfChainLength(astPath) >= LOOKUP_CHAIN_MIN_BRANCHES;
      const isUnnamedTest = !isNamedCondition(expr);
      const shouldFlagTest = isUnnamedTest && !isLookupChain;
      if (shouldFlagTest) {
        const line = resolveStartLine(expr, astPath.node, 1);
        const meta = RULE_REGISTRY.CONTROL_FLOW_INLINE_BOOLEAN;
        violations.push({
          filePath: relativePath,
          line,
          column: expr.loc?.start.column || 1,
          hazard: 'The if asks instead of reading a named condition. Name the question first (Directive 3.A).',
          rule: 'CONTROL_FLOW_INLINE_BOOLEAN',
          severity: countJunctionOperators(expr) > 0 ? meta.severity : 'LOW',
          pillar: meta.pillar,
          directive: meta.directive
        });
      }

      const silentGuard = isSilentGuardClause(astPath, t);
      if (silentGuard) {
        const line = astPath.node.loc?.start.line || 1;
        const meta = RULE_REGISTRY.CONTROL_FLOW_SILENT_GUARD;
        violations.push({
          filePath: relativePath,
          line,
          column: astPath.node.loc?.start.column || 1,
          hazard: `Silent guard abort detected in ${silentGuard.funcName}: bare return; swallows error condition without logging or error state. Return [null, error] or emit diagnostic per Directive 3.G.`,
          rule: 'CONTROL_FLOW_SILENT_GUARD',
          severity: meta.severity,
          pillar: meta.pillar,
          directive: meta.directive
        });
      }
    },

    ConditionalExpression(astPath) {
      const isOutermostOfChain = !astPath.parentPath?.isConditionalExpression();
      const hasNestedBranch = t.isConditionalExpression(astPath.node.consequent) || t.isConditionalExpression(astPath.node.alternate);
      const isNestedTernaryRoot = hasNestedBranch && isOutermostOfChain;
      if (isNestedTernaryRoot) {
        const line = astPath.node.loc?.start.line || 1;
        const meta = RULE_REGISTRY.CONTROL_FLOW_NESTED_TERNARY;
        violations.push({
          filePath: relativePath,
          line,
          column: astPath.node.loc?.start.column || 1,
          hazard: 'Nested ternary operator detected',
          rule: 'CONTROL_FLOW_NESTED_TERNARY',
          severity: meta.severity,
          pillar: meta.pillar,
          directive: meta.directive
        });
      }
    },

    SwitchStatement(astPath) {
      const cases = astPath.node.cases || [];
      const hasTooFewCases = cases.length < 3;
      if (hasTooFewCases) return;

      const isDispatchConsequent = (statements) => {
        const isEmptyConsequent = !statements || statements.length === 0;
        if (isEmptyConsequent) return false;
        const isSingleStatement = statements.length === 1;
        if (isSingleStatement) {
          const s = statements[0];
          if (t.isReturnStatement(s)) return true;
          if (t.isBlockStatement(s)) {
            return s.body.length === 1 && t.isReturnStatement(s.body[0]);
          }
        }
        const isStatementPair = statements.length === 2;
        if (isStatementPair) {
          const [first, second] = statements;
          if (t.isBreakStatement(second)) {
            return t.isExpressionStatement(first) || t.isAssignmentExpression(first);
          }
        }
        return false;
      };

      let dispatchCaseCount = 0;
      let nonDefaultCount = 0;

      for (const switchCase of cases) {
        const isDefaultCase = !switchCase.test;
        if (isDefaultCase) continue;
        nonDefaultCount += 1;
        if (isDispatchConsequent(switchCase.consequent)) {
          dispatchCaseCount += 1;
        }
      }

      const isDispatchSmell = nonDefaultCount >= 3 && (dispatchCaseCount / nonDefaultCount) >= 0.7;
      if (isDispatchSmell) {
        const line = astPath.node.loc?.start.line || 1;
        const meta = RULE_REGISTRY.CONTROL_FLOW_DISPATCH_SWITCH;
        violations.push({
          filePath: relativePath,
          line,
          column: astPath.node.loc?.start.column || 1,
          hazard: `Dispatch switch smell detected (${dispatchCaseCount} repetitive case branches)`,
          rule: 'CONTROL_FLOW_DISPATCH_SWITCH',
          severity: meta.severity,
          pillar: meta.pillar,
          directive: meta.directive
        });
      }
    },

    // Pillar 5: Design System & Inline Styles
    JSXAttribute(astPath) {
      const attrName = astPath.node.name?.name;
      const isStyleAttr = attrName === 'style';
      const isClassAttr = attrName === 'className' || attrName === 'class';
      if (isStyleAttr) {
        const value = astPath.node.value;
        const isObjectStyle = t.isJSXExpressionContainer(value) && t.isObjectExpression(value.expression);
        if (isObjectStyle) {
          const preferTokens = config?.preferDesignTokens || 'warning';
          const isTokenCheckEnabled = preferTokens !== 'off';
          if (isTokenCheckEnabled) {
            const line = astPath.node.loc?.start.line || 1;
            const meta = RULE_REGISTRY.RAW_INLINE_STYLE;
            const severity = preferTokens === 'error' ? 'HIGH' : meta.severity;
            violations.push({
              filePath: relativePath,
              line,
              column: astPath.node.loc?.start.column || 1,
              hazard: 'Raw inline style attribute detected in JSX',
              rule: 'RAW_INLINE_STYLE',
              severity,
              pillar: meta.pillar,
              directive: meta.directive
            });
          }
        }
      } else if (isClassAttr) {
        const value = astPath.node.value;
        const strVal = t.isStringLiteral(value) ? value.value : '';
        const hasFontAwesomeClass = Boolean(strVal && (strVal.includes('fa-') || strVal.includes('fa ')));
        if (hasFontAwesomeClass) {
          const hasTextColorClass = /\btext-(primary|secondary|danger|warning|success|info|light|dark|\w+)\b/.test(strVal);
          if (hasTextColorClass) {
            const line = astPath.node.loc?.start.line || 1;
            const meta = RULE_REGISTRY.ICON_SVG_STYLE_LEAK;
            violations.push({
              filePath: relativePath,
              line,
              column: astPath.node.loc?.start.column || 1,
              hazard: 'FontAwesome icon with text-* class breaks SVG fill',
              rule: 'ICON_SVG_STYLE_LEAK',
              severity: meta.severity,
              pillar: meta.pillar,
              directive: meta.directive
            });
          }
        }
      }
    },

    // Pillar 6 & Pillar 7: Call Expressions (Timers & Logging)
    CallExpression(astPath) {
      const callee = astPath.node.callee;

      // Timer Discipline
      const isTimerCall = t.isIdentifier(callee) && (callee.name === 'setInterval' || callee.name === 'setTimeout');
      if (isTimerCall) {
        const args = astPath.node.arguments;
        const delayArg = args[1];

        // Render-hack check: setTimeout(fn, 0)
        if (isZeroDelayTimeout(callee, delayArg, t)) {
          const line = astPath.node.loc?.start.line || 1;
          const meta = RULE_REGISTRY.RENDER_HACK_TIMEOUT;
          violations.push({
            filePath: relativePath,
            line,
            column: astPath.node.loc?.start.column || 1,
            hazard: 'Zero-delay render hack setTimeout(..., 0) detected',
            rule: 'RENDER_HACK_TIMEOUT',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
        }

        const disposal = classifyTimerDisposal(astPath, teardowns);
        const isUndisposed = disposal === 'held' || disposal === 'unheld';
        if (isUndisposed) {
          const line = astPath.node.loc?.start.line || 1;
          const meta = RULE_REGISTRY.TIMER_DISCIPLINE;
          const clearName = callee.name === 'setInterval' ? 'clearInterval' : 'clearTimeout';
          violations.push({
            filePath: relativePath,
            line,
            column: astPath.node.loc?.start.column || 1,
            hazard: `Raw ${callee.name} with no ${clearName} for its handle anywhere in this module (Directive 6.C)`,
            rule: 'TIMER_DISCIPLINE',
            severity: TIMER_SEVERITY_BY_KIND[callee.name] || meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
        }
      }

      // Unguarded Logging
      if (isUnguardedConsoleCall(callee, t)) {
        const line = astPath.node.loc?.start.line || 1;
        const meta = RULE_REGISTRY.UNGUARDED_LOGGING;
        violations.push({
          filePath: relativePath,
          line,
          column: astPath.node.loc?.start.column || 1,
          hazard: `Unguarded console.${callee.property.name} statement`,
          rule: 'UNGUARDED_LOGGING',
          severity: meta.severity,
          pillar: meta.pillar,
          directive: meta.directive
        });
      }

      // Pillar 6: Orphaned Event Listener
      const isAddListenerCall = t.isMemberExpression(callee) && t.isIdentifier(callee.property, { name: 'addEventListener' });
      if (isAddListenerCall) {
        const hasCleanup = isListenerDisposed(astPath, teardowns);
        if (!hasCleanup) {
          const line = astPath.node.loc?.start.line || 1;
          const meta = RULE_REGISTRY.LIFECYCLE_ORPHANED_LISTENER;
          violations.push({
            filePath: relativePath,
            line,
            column: astPath.node.loc?.start.column || 1,
            hazard: 'Raw addEventListener call lacking lifecycle disposer or removeEventListener teardown',
            rule: 'LIFECYCLE_ORPHANED_LISTENER',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
        }
      }

      // Pillar 2: Combinator Raw Boolean Arguments
      if (isCombinatorCall(callee, t)) {
        const hasRawArg = astPath.node.arguments.some((arg) => isRawBooleanArg(arg, t));
        if (hasRawArg) {
          const line = astPath.node.loc?.start.line || 1;
          const meta = RULE_REGISTRY.COMBINATOR_RAW_BOOLEAN;
          violations.push({
            filePath: relativePath,
            line,
            column: astPath.node.loc?.start.column || 1,
            hazard: `Raw boolean expression passed to ${callee.name}(). Decompose into named predicate or thunk.`,
            rule: 'COMBINATOR_RAW_BOOLEAN',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
        }
      }
    },

    // Pillar 2: Swallowed Exceptions
    CatchClause(astPath) {
      if (isSwallowedCatch(astPath)) {
        const meta = RULE_REGISTRY.ERROR_SWALLOWED_EXCEPTION;
        const { severity, binding } = resolveCatchEscalation(astPath);
        const finding = binding
          ? `Swallowed exception leaves "${binding}" unset; it is read after the try (silent undefined propagation)`
          : 'Swallowed exception in catch block without active handling, logging, or ResultTuple';
        violations.push({
          filePath: relativePath,
          ...resolveCatchSpan(astPath),
          hazard: `${finding}. Annotate intentional cases with // chemx-allow: best-effort <reason>`,
          rule: 'ERROR_SWALLOWED_EXCEPTION',
          severity,
          pillar: meta.pillar,
          directive: meta.directive
        });
      }
    },

    // Pillar 4: Deep Optional Chaining Churn
    OptionalMemberExpression(astPath) {
      const isParentOptional = t.isOptionalMemberExpression(astPath.parent) || t.isOptionalCallExpression(astPath.parent);
      if (!isParentOptional) {
        const depth = countOptionalChainingDepth(astPath.node, t);
        const isDeepChain = depth >= 3;
        if (isDeepChain) {
          const line = astPath.node.loc?.start.line || 1;
          const meta = RULE_REGISTRY.DATA_FLOW_OPTIONAL_CHAINING_CHURN;
          violations.push({
            filePath: relativePath,
            line,
            column: astPath.node.loc?.start.column || 1,
            hazard: `Deep optional chaining churn (${depth} chained operators >= 3 limit). Level data shapes line 1.`,
            rule: 'DATA_FLOW_OPTIONAL_CHAINING_CHURN',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
        }
      }
    },

    // Pillar 4: Type Co-location
    TSTypeLiteral(astPath) {
      const isLargeLiteral = astPath.node.members.length > 3;
      if (isLargeLiteral) {
        const isInlinedType = !astPath.findParent((p) => p.isTSTypeAliasDeclaration() || p.isTSInterfaceDeclaration());
        if (isInlinedType) {
          const line = astPath.node.loc?.start.line || 1;
          const meta = RULE_REGISTRY.TYPE_COLOCATION;
          violations.push({
            filePath: relativePath,
            line,
            column: astPath.node.loc?.start.column || 1,
            hazard: `Inlined anonymous complex type (${astPath.node.members.length} members)`,
            rule: 'TYPE_COLOCATION',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
        }
      }
    }
  };
};
