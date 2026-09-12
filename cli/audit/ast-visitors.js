import * as t from '@babel/types';
import { RULE_REGISTRY } from './rules-registry.js';
import { countLogicalOperators } from './rules-helpers.js';
import {
  isCustomHookFunction,
  resolveStartLine,
  isZeroDelayTimeout,
  isUnguardedConsoleCall
} from './rules-predicates.js';

export const createAstVisitors = ({ relativePath, violations }) => {
  return {
    Function(astPath) {
      const isCustomHook = isCustomHookFunction(astPath);

      // Pillar 3: Hook Saturation
      let hookCount = 0;
      astPath.traverse({
        CallExpression(callPath) {
          const callee = callPath.node.callee;
          if (t.isIdentifier(callee) && /^use[A-Z0-9]/.test(callee.name)) {
            if (callPath.getFunctionParent() === astPath) {
              hookCount += 1;
            }
          }
        }
      });

      if (hookCount > 5) {
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
            if (retPath.getFunctionParent() === astPath && t.isObjectExpression(retPath.node.argument)) {
              const propCount = retPath.node.argument.properties.length;
              if (propCount > 5) {
                const line = retPath.node.loc?.start.line || 1;
                const meta = RULE_REGISTRY.HOOK_RETURN_OVERLOAD;
                violations.push({
                  filePath: relativePath,
                  line,
                  column: retPath.node.loc?.start.column || 1,
                  hazard: `Hook return saturation (${propCount} properties > 5 limit)`,
                  rule: 'HOOK_RETURN_OVERLOAD',
                  severity: meta.severity,
                  pillar: meta.pillar,
                  directive: meta.directive
                });
              }
            }
          }
        });
      }
    },

    // Pillar 2: Control Flow Complexity
    JSXExpressionContainer(astPath) {
      const expr = astPath.node.expression;
      if (t.isLogicalExpression(expr) || t.isUnaryExpression(expr)) {
        const opCount = countLogicalOperators(expr);
        if (opCount > 2) {
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

    ConditionalExpression(astPath) {
      if (t.isConditionalExpression(astPath.node.consequent) || t.isConditionalExpression(astPath.node.alternate)) {
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

    // Pillar 5: Design System & Inline Styles
    JSXAttribute(astPath) {
      const attrName = astPath.node.name?.name;
      if (attrName === 'style') {
        const value = astPath.node.value;
        if (t.isJSXExpressionContainer(value) && t.isObjectExpression(value.expression)) {
          const line = astPath.node.loc?.start.line || 1;
          const meta = RULE_REGISTRY.RAW_INLINE_STYLE;
          violations.push({
            filePath: relativePath,
            line,
            column: astPath.node.loc?.start.column || 1,
            hazard: 'Raw inline style attribute detected in JSX',
            rule: 'RAW_INLINE_STYLE',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
        }
      } else if (attrName === 'className' || attrName === 'class') {
        const value = astPath.node.value;
        const strVal = t.isStringLiteral(value) ? value.value : '';
        if (strVal && (strVal.includes('fa-') || strVal.includes('fa '))) {
          if (/\btext-(primary|secondary|danger|warning|success|info|light|dark|\w+)\b/.test(strVal)) {
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
      if (t.isIdentifier(callee) && (callee.name === 'setInterval' || callee.name === 'setTimeout')) {
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

        const fnParent = astPath.getFunctionParent();
        let hasCleanup = false;
        if (fnParent) {
          fnParent.traverse({
            ReturnStatement(retPath) {
              if (retPath.node.argument) {
                hasCleanup = true;
              }
            }
          });
        }

        if (!hasCleanup) {
          const line = astPath.node.loc?.start.line || 1;
          const meta = RULE_REGISTRY.TIMER_DISCIPLINE;
          violations.push({
            filePath: relativePath,
            line,
            column: astPath.node.loc?.start.column || 1,
            hazard: `Raw ${callee.name} lacking lifecycle scope disposal`,
            rule: 'TIMER_DISCIPLINE',
            severity: meta.severity,
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
    },

    // Pillar 4: Type Co-location
    TSTypeLiteral(astPath) {
      if (astPath.node.members.length > 3) {
        if (!astPath.findParent((p) => p.isTSTypeAliasDeclaration() || p.isTSInterfaceDeclaration())) {
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
