import * as t from '@babel/types';
import { RULE_REGISTRY } from './rules-registry.js';
import { checkExtendedTextPatterns } from './extended-text-patterns.js';

export { checkExtendedTextPatterns };

const BARE_BOOLEANS = new Set([
  'loading', 'valid', 'active', 'visible', 'open', 'disabled',
  'checked', 'ready', 'editing', 'submitting', 'pending', 'busy',
  'selected', 'expanded'
]);

const BARE_HANDLERS = new Set([
  'checkout', 'submit', 'save', 'delete', 'close', 'open',
  'reset', 'confirm', 'cancel', 'refresh', 'sync', 'send', 'pay'
]);

const SENSITIVE_KEYWORDS = new Set([
  'password', 'passwd', 'secret', 'token', 'apikey', 'api_key',
  'authtoken', 'auth_token', 'accesstoken', 'access_token',
  'refreshtoken', 'refresh_token', 'privatekey', 'private_key',
  'creditcard', 'credit_card', 'ssn'
]);

const isSensitiveName = (name = '') => {
  const normalized = String(name).toLowerCase();
  if (SENSITIVE_KEYWORDS.has(normalized)) return true;
  return /^(pass(word)?|token|secret|api[_-]?key)$/i.test(normalized);
};

const JAVASCRIPT_URL_REGEX = /^\s*javascript:/i;

const resolvePropertyKeyName = (key) => {
  const isIdentifier = t.isIdentifier(key);
  if (isIdentifier) return key.name;
  const isStringLiteral = t.isStringLiteral(key);
  if (isStringLiteral) return key.value;
  return '';
};

const isSensitiveExpression = (node) => {
  if (!node) return false;
  if (t.isIdentifier(node)) {
    return isSensitiveName(node.name);
  }
  if (t.isMemberExpression(node)) {
    if (t.isIdentifier(node.property)) {
      return isSensitiveName(node.property.name);
    }
    if (t.isStringLiteral(node.property)) {
      return isSensitiveName(node.property.value);
    }
  }
  if (t.isObjectExpression(node)) {
    return node.properties.some((prop) => {
      if (t.isObjectProperty(prop)) {
        const keyName = resolvePropertyKeyName(prop.key);
        return isSensitiveName(keyName);
      }
      return false;
    });
  }
  if (t.isTemplateLiteral(node)) {
    return node.expressions.some(isSensitiveExpression);
  }
  return false;
};

export const createExtendedVisitors = ({ relativePath, violations }) => {
  return {
    JSXOpeningElement(astPath) {
      const tagName = astPath.node.name?.name;

      // Pillar 8: Clickable non-semantic JSX elements (div, span)
      const isGenericContainer = tagName === 'div' || tagName === 'span';
      if (isGenericContainer) {
        const isClickAttr = (attr) => t.isJSXAttribute(attr) && attr.name?.name === 'onClick';
        const isRoleAttr = (attr) => t.isJSXAttribute(attr) && attr.name?.name === 'role';
        const hasClick = astPath.node.attributes.some(isClickAttr);
        const hasRole = astPath.node.attributes.some(isRoleAttr);
        const isClickableWithoutRole = hasClick && !hasRole;

        if (isClickableWithoutRole) {
          const line = astPath.node.loc?.start.line || 1;
          const meta = RULE_REGISTRY.A11Y_CLICKABLE_NON_SEMANTIC;
          violations.push({
            filePath: relativePath,
            line,
            column: astPath.node.loc?.start.column || 1,
            hazard: `Clickable non-semantic <${tagName}> detected without native button/link element`,
            rule: 'A11Y_CLICKABLE_NON_SEMANTIC',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
        }
      }

      // Pillar 8: Missing alt attribute on img JSX
      const isImgElement = tagName === 'img';
      if (isImgElement) {
        const isAltAttr = (attr) => t.isJSXAttribute(attr) && attr.name?.name === 'alt';
        const hasAlt = astPath.node.attributes.some(isAltAttr);
        const isMissingAlt = !hasAlt;

        if (isMissingAlt) {
          const line = astPath.node.loc?.start.line || 1;
          const meta = RULE_REGISTRY.A11Y_IMAGE_MISSING_ALT;
          violations.push({
            filePath: relativePath,
            line,
            column: astPath.node.loc?.start.column || 1,
            hazard: 'Image element missing alt text attribute in JSX',
            rule: 'A11Y_IMAGE_MISSING_ALT',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
        }
      }

      // Pillar 9: External link target="_blank" without rel="noopener noreferrer"
      const isAnchorElement = tagName === 'a';
      if (isAnchorElement) {
        const targetAttr = astPath.node.attributes.find((attr) => t.isJSXAttribute(attr) && attr.name?.name === 'target');
        let isTargetBlank = false;
        if (targetAttr) {
          if (t.isStringLiteral(targetAttr.value)) {
            isTargetBlank = targetAttr.value.value.trim().toLowerCase() === '_blank';
          } else if (t.isJSXExpressionContainer(targetAttr.value) && t.isStringLiteral(targetAttr.value.expression)) {
            isTargetBlank = targetAttr.value.expression.value.trim().toLowerCase() === '_blank';
          }
        }

        if (isTargetBlank) {
          const relAttr = astPath.node.attributes.find((attr) => t.isJSXAttribute(attr) && attr.name?.name === 'rel');
          let hasRelProtection = false;
          if (relAttr) {
            if (t.isStringLiteral(relAttr.value)) {
              const val = relAttr.value.value.toLowerCase();
              hasRelProtection = val.includes('noopener') || val.includes('noreferrer');
            } else if (t.isJSXExpressionContainer(relAttr.value) && t.isStringLiteral(relAttr.value.expression)) {
              const val = relAttr.value.expression.value.toLowerCase();
              hasRelProtection = val.includes('noopener') || val.includes('noreferrer');
            }
          }

          if (!hasRelProtection) {
            const line = astPath.node.loc?.start.line || 1;
            const meta = RULE_REGISTRY.SECURITY_REVERSE_TABNABBING;
            violations.push({
              filePath: relativePath,
              line,
              column: astPath.node.loc?.start.column || 1,
              hazard: 'External link with target="_blank" missing rel="noopener noreferrer"',
              rule: 'SECURITY_REVERSE_TABNABBING',
              severity: meta.severity,
              pillar: meta.pillar,
              directive: meta.directive
            });
          }
        }
      }
    },

    JSXAttribute(astPath) {
      const attrName = astPath.node.name?.name;

      // Pillar 9: dangerouslySetInnerHTML without sanitizer
      const isDangerouslySetHtml = attrName === 'dangerouslySetInnerHTML';
      if (isDangerouslySetHtml) {
        const value = astPath.node.value;
        let isSanitized = false;

        if (t.isJSXExpressionContainer(value)) {
          const expr = value.expression;
          if (t.isObjectExpression(expr)) {
            for (const prop of expr.properties) {
              const isHtmlProp = t.isObjectProperty(prop) && prop.key?.name === '__html';
              if (isHtmlProp && t.isCallExpression(prop.value)) {
                const calleeName = prop.value.callee?.name || prop.value.callee?.property?.name || '';
                const hasSanitizeCallee = /sanitize/i.test(calleeName);
                if (hasSanitizeCallee) isSanitized = true;
              }
            }
          }
        }

        const isUnsanitized = !isSanitized;
        if (isUnsanitized) {
          const line = astPath.node.loc?.start.line || 1;
          const meta = RULE_REGISTRY.SECURITY_RAW_HTML_INJECTION;
          violations.push({
            filePath: relativePath,
            line,
            column: astPath.node.loc?.start.column || 1,
            hazard: 'Unsanitized HTML injection via dangerouslySetInnerHTML without DOMPurify',
            rule: 'SECURITY_RAW_HTML_INJECTION',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
        }
      }

      // Pillar 11: Action handler naming (e.g. onClick={checkout} instead of onClick={handleCheckout})
      const isActionHandler = attrName === 'onClick' || attrName === 'onSubmit';
      if (isActionHandler) {
        const value = astPath.node.value;
        const isContainerExpr = t.isJSXExpressionContainer(value);
        const isIdentifierExpr = isContainerExpr && t.isIdentifier(value.expression);

        if (isIdentifierExpr) {
          const fnName = value.expression.name;
          const isBareHandler = BARE_HANDLERS.has(fnName.toLowerCase());

          if (isBareHandler) {
            const line = astPath.node.loc?.start.line || 1;
            const meta = RULE_REGISTRY.NAMING_HANDLER_PREFIX;
            const suggested = `handle${fnName.charAt(0).toUpperCase()}${fnName.slice(1)}`;
            violations.push({
              filePath: relativePath,
              line,
              column: astPath.node.loc?.start.column || 1,
              hazard: `Action handler "${fnName}" missing handle prefix (e.g. ${suggested})`,
              rule: 'NAMING_HANDLER_PREFIX',
              severity: meta.severity,
              pillar: meta.pillar,
              directive: meta.directive
            });
          }
        }
      }

      // Pillar 9: javascript: pseudo-protocol URL in JSX
      const isUrlAttribute = ['href', 'src', 'action', 'formAction'].includes(attrName);
      if (isUrlAttribute) {
        let isJsUrl = false;
        const val = astPath.node.value;
        if (t.isStringLiteral(val)) {
          isJsUrl = JAVASCRIPT_URL_REGEX.test(val.value);
        } else if (t.isJSXExpressionContainer(val)) {
          const expr = val.expression;
          if (t.isStringLiteral(expr)) {
            isJsUrl = JAVASCRIPT_URL_REGEX.test(expr.value);
          } else if (t.isTemplateLiteral(expr) && expr.quasis.length > 0) {
            isJsUrl = JAVASCRIPT_URL_REGEX.test(expr.quasis[0].value.raw);
          }
        }

        if (isJsUrl) {
          const line = astPath.node.loc?.start.line || 1;
          const meta = RULE_REGISTRY.SECURITY_JAVASCRIPT_URL;
          violations.push({
            filePath: relativePath,
            line,
            column: astPath.node.loc?.start.column || 1,
            hazard: `javascript: pseudo-protocol detected in ${attrName} attribute`,
            rule: 'SECURITY_JAVASCRIPT_URL',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
        }
      }
    },

    CallExpression(astPath) {
      const callee = astPath.node.callee;

      // Pillar 9: Dynamic code execution via eval()
      if (t.isIdentifier(callee) && callee.name === 'eval') {
        const line = astPath.node.loc?.start.line || 1;
        const meta = RULE_REGISTRY.SECURITY_DYNAMIC_CODE_EXECUTION;
        violations.push({
          filePath: relativePath,
          line,
          column: astPath.node.loc?.start.column || 1,
          hazard: 'Dynamic code execution via eval() detected',
          rule: 'SECURITY_DYNAMIC_CODE_EXECUTION',
          severity: meta.severity,
          pillar: meta.pillar,
          directive: meta.directive
        });
      }

      // Pillar 9: String-based code execution in setTimeout/setInterval
      if (t.isIdentifier(callee) && (callee.name === 'setTimeout' || callee.name === 'setInterval')) {
        const firstArg = astPath.node.arguments[0];
        const isStringExecution = t.isStringLiteral(firstArg) || t.isTemplateLiteral(firstArg);
        if (isStringExecution) {
          const line = astPath.node.loc?.start.line || 1;
          const meta = RULE_REGISTRY.SECURITY_DYNAMIC_CODE_EXECUTION;
          violations.push({
            filePath: relativePath,
            line,
            column: astPath.node.loc?.start.column || 1,
            hazard: `String-based dynamic code execution in ${callee.name} detected`,
            rule: 'SECURITY_DYNAMIC_CODE_EXECUTION',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
        }
      }

      // Pillar 9: Sensitive credential/token logging in console
      const isConsoleCall = t.isMemberExpression(callee) && t.isIdentifier(callee.object) && callee.object.name === 'console';
      if (isConsoleCall) {
        const args = astPath.node.arguments || [];
        const hasSensitiveArg = args.some(isSensitiveExpression);
        if (hasSensitiveArg) {
          const line = astPath.node.loc?.start.line || 1;
          const meta = RULE_REGISTRY.SECURITY_SENSITIVE_LOGGING;
          violations.push({
            filePath: relativePath,
            line,
            column: astPath.node.loc?.start.column || 1,
            hazard: 'Sensitive variable (credential, token, or password) logged to console',
            rule: 'SECURITY_SENSITIVE_LOGGING',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
        }
      }
    },

    NewExpression(astPath) {
      // Pillar 9: Dynamic code execution via new Function()
      const callee = astPath.node.callee;
      if (t.isIdentifier(callee) && callee.name === 'Function') {
        const line = astPath.node.loc?.start.line || 1;
        const meta = RULE_REGISTRY.SECURITY_DYNAMIC_CODE_EXECUTION;
        violations.push({
          filePath: relativePath,
          line,
          column: astPath.node.loc?.start.column || 1,
          hazard: 'Dynamic code execution via new Function() constructor detected',
          rule: 'SECURITY_DYNAMIC_CODE_EXECUTION',
          severity: meta.severity,
          pillar: meta.pillar,
          directive: meta.directive
        });
      }
    },

    VariableDeclarator(astPath) {
      // Pillar 11: Bare boolean variables missing is/has/can/should prefix
      const isIdentifierNode = t.isIdentifier(astPath.node.id);
      const hasInitNode = Boolean(astPath.node.init);
      const canInspectDeclarator = isIdentifierNode && hasInitNode;

      if (canInspectDeclarator) {
        const varName = astPath.node.id.name;
        const isBareBoolean = BARE_BOOLEANS.has(varName.toLowerCase());

        if (isBareBoolean) {
          let isBooleanInit = false;
          const init = astPath.node.init;

          if (t.isBooleanLiteral(init)) {
            isBooleanInit = true;
          } else if (t.isCallExpression(init)) {
            const callee = init.callee;
            const calleeName = t.isIdentifier(callee) ? callee.name : '';
            const isRefOrStateHook = calleeName === 'ref' || calleeName === 'useState';

            if (isRefOrStateHook) {
              const arg = init.arguments[0];
              const isBoolLiteral = t.isBooleanLiteral(arg);
              if (isBoolLiteral) isBooleanInit = true;
            }
          }

          if (isBooleanInit) {
            const line = astPath.node.loc?.start.line || 1;
            const meta = RULE_REGISTRY.NAMING_BARE_BOOLEAN;
            violations.push({
              filePath: relativePath,
              line,
              column: astPath.node.loc?.start.column || 1,
              hazard: `Bare boolean variable "${varName}" missing is/has/can/should prefix`,
              rule: 'NAMING_BARE_BOOLEAN',
              severity: meta.severity,
              pillar: meta.pillar,
              directive: meta.directive
            });
          }
        }
      }
    }
  };
};
