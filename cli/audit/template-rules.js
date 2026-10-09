/**
 * Expression-level rules on the Vue template AST (finding vue-sfc-blind-spots):
 * nested ternaries (Directive 3.D), inline boolean soup (3.A), and raw inline
 * styles (5.A: static style="..." or a :style object that sets more than CSS
 * custom properties).
 */
import * as t from '@babel/types';
import { RULE_REGISTRY } from './rules-registry.js';
import { walkTemplate, walkBabel, resolveExpressionLocation } from '../sfc/template-walk.js';
import { countJunctionOperators } from './lexicon-predicates.js';

const MAX_TEMPLATE_JUNCTIONS = 2;

const buildViolation = (relativePath, rule, location, hazard) => {
  const meta = RULE_REGISTRY[rule];
  return {
    filePath: relativePath,
    line: location.line,
    column: location.column,
    hazard,
    rule,
    severity: meta.severity,
    pillar: meta.pillar,
    directive: meta.directive
  };
};

const isNestedTernary = (node) => t.isConditionalExpression(node) &&
  (t.isConditionalExpression(node.consequent) || t.isConditionalExpression(node.alternate));

const isCustomPropertyKey = (prop) => {
  const key = t.isObjectProperty(prop) ? prop.key : null;
  const keyName = t.isStringLiteral(key) ? key.value : '';
  return keyName.startsWith('--');
};

const isRawStyleObject = (ast) => t.isObjectExpression(ast) && !ast.properties.every(isCustomPropertyKey);

const checkExpression = (entry, relativePath, violations) => {
  const { exp, ast, directive } = entry;
  if (!ast) return;
  walkBabel(ast, (node, parent) => {
    const isOutermost = !t.isConditionalExpression(parent);
    if (isNestedTernary(node) && isOutermost) {
      const location = resolveExpressionLocation(exp, node);
      violations.push(buildViolation(relativePath, 'CONTROL_FLOW_NESTED_TERNARY', location, 'Nested ternary in template expression (Directive 3.D)'));
    }
  });
  const junctions = countJunctionOperators(ast);
  if (junctions > MAX_TEMPLATE_JUNCTIONS) {
    const location = resolveExpressionLocation(exp, ast);
    violations.push(buildViolation(relativePath, 'CONTROL_FLOW_INLINE_BOOLEAN', location, `Inline boolean in template (${junctions} logical operators > ${MAX_TEMPLATE_JUNCTIONS}); name it in a computed`));
  }
  const isStyleBinding = directive?.name === 'bind' && directive.arg === 'style';
  if (isStyleBinding && isRawStyleObject(ast)) {
    const location = resolveExpressionLocation(exp, ast);
    violations.push(buildViolation(relativePath, 'RAW_INLINE_STYLE', location, 'Raw inline :style object in template; only CSS custom properties belong here (Directive 5.A)'));
  }
};

/** Returns violations for one parsed SFC template block. */
export const auditTemplate = (template, relativePath) => {
  const violations = [];
  if (!template?.ast) return violations;
  walkTemplate(template.ast, {
    onAttribute({ attribute }) {
      const isStaticStyle = attribute.name === 'style' && Boolean(attribute.value?.content?.trim());
      if (isStaticStyle) {
        const location = { line: attribute.loc.start.line, column: attribute.loc.start.column };
        violations.push(buildViolation(relativePath, 'RAW_INLINE_STYLE', location, 'Raw inline style="..." attribute in template (Directive 5.A)'));
      }
    },
    onExpression(entry) {
      checkExpression(entry, relativePath, violations);
    }
  });
  return violations;
};
