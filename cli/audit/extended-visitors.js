import fs from 'node:fs';
import path from 'node:path';
import * as t from '@babel/types';
import { RULE_REGISTRY } from './rules-registry.js';
import { toResultSync } from './rules-helpers.js';

const BARE_BOOLEANS = new Set([
  'loading', 'valid', 'active', 'visible', 'open', 'disabled',
  'checked', 'ready', 'editing', 'submitting', 'pending', 'busy',
  'selected', 'expanded'
]);

const BARE_HANDLERS = new Set([
  'checkout', 'submit', 'save', 'delete', 'close', 'open',
  'reset', 'confirm', 'cancel', 'refresh', 'sync', 'send', 'pay'
]);

const SECRET_PATTERNS = [
  /(['"])(?:sk-[a-zA-Z0-9_-]{24,}|ghp_[a-zA-Z0-9]{30,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z-_]{35})\1/
];

const FAKE_GREEN_PATTERNS = [
  /expect\s*\(\s*(true|false|1|0)\s*\)\s*\.\s*to(?:Be|Equal|StrictEqual)\s*\(\s*\1\s*\)/,
  /assert\s*\.\s*(?:strictEqual|equal|deepEqual)\s*\(\s*(true|false|1|0)\s*,\s*\1\s*\)/,
  /assert\s*\.\s*ok\s*\(\s*(?:true|1)\s*\)/
];

const IMG_WITHOUT_ALT_PATTERN = new RegExp(['<', 'img\\b', '(?![^>]*\\balt\\s*=)', '[^>]*>'].join(''), 'i');
const CLICKABLE_CONTAINER_PATTERN = new RegExp(['<', '(div|span)\\b', '(?![^>]*\\brole\\s*=\\s*[\'"](?:button|link|tab)[\'"])', '[^>]*\\b(?:@click|v-on:click)\\s*='].join(''), 'i');

/**
 * Pillar 10: Check for co-located test files for molecule capsules.
 */
const checkMoleculeCoLocatedTest = (filePath, relativePath, violations) => {
  const baseName = path.basename(filePath);
  const ext = path.extname(filePath);

  // Stage 1: Atomic Concept Declarations
  const isMoleculePath = relativePath.includes('molecules') || baseName.startsWith('m-');
  const isComponentExt = ext === '.vue' || ext === '.tsx' || ext === '.jsx';
  const isTestOrSpecFile = baseName.includes('.spec.') || baseName.includes('.test.');

  // Stage 2: Unified Decision Variable & Early Guard Clause
  const isMoleculeComponent = isMoleculePath && isComponentExt && !isTestOrSpecFile;
  if (!isMoleculeComponent) return;

  const dir = path.dirname(filePath);
  const [siblings, dirError] = toResultSync(() => (fs.existsSync(dir) ? fs.readdirSync(dir) : []));

  // Stage 1: Atomic Guard Check
  const hasDirError = Boolean(dirError);
  const hasSiblings = Boolean(siblings);
  const canInspectSiblings = !hasDirError && hasSiblings;
  if (!canInspectSiblings) return;

  const isTestSibling = (fileName) => /\.(test|spec)\.[jt]sx?$/.test(fileName);
  const hasCoLocatedTest = siblings.some(isTestSibling);
  if (hasCoLocatedTest) return;

  const meta = RULE_REGISTRY.TEST_MISSING_COLOCATED;
  violations.push({
    filePath: relativePath,
    line: 1,
    column: 1,
    hazard: 'Molecule capsule missing co-located test file (*.spec.ts or *.test.ts)',
    rule: 'TEST_MISSING_COLOCATED',
    severity: meta.severity,
    pillar: meta.pillar,
    directive: meta.directive
  });
};

export const checkExtendedTextPatterns = (content, lines, relativePath, filePath, violations) => {
  checkMoleculeCoLocatedTest(filePath, relativePath, violations);

  const isTestFile = /\.(test|spec)\.[jt]sx?$/.test(filePath);
  const ext = path.extname(filePath);
  const isTemplateFile = ext === '.vue' || ext === '.html' || ext === '.svelte';

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;
    const trimmed = lineText.trim();
    const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');

    // Pillar 9: Hardcoded Secret Detection
    const hasEnvReference = trimmed.includes('process.env') || trimmed.includes('import.meta.env');
    const canScanSecrets = !isComment && !hasEnvReference;

    if (canScanSecrets) {
      for (const pat of SECRET_PATTERNS) {
        const matchesSecretPattern = pat.test(lineText);
        const hasPlaceholder = lineText.includes('dummy') || lineText.includes('placeholder');
        const isHardcodedSecret = matchesSecretPattern && !hasPlaceholder;

        if (isHardcodedSecret) {
          const meta = RULE_REGISTRY.SECURITY_HARDCODED_SECRET;
          violations.push({
            filePath: relativePath,
            line: lineNum,
            column: 1,
            hazard: 'High-entropy API key or secret token detected in source code',
            rule: 'SECURITY_HARDCODED_SECRET',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
          break;
        }
      }
    }

    // Pillar 9: Unsanitized v-html injection (Vue / HTML templates)
    const hasVHtml = isTemplateFile && /\bv-html\s*=\s*["']/.test(lineText);
    if (hasVHtml) {
      const hasSanitizer = /(?:sanitize|DOMPurify|escapeHtml|filterXSS)/i.test(lineText);
      const isUnsanitizedVHtml = !hasSanitizer;

      if (isUnsanitizedVHtml) {
        const meta = RULE_REGISTRY.SECURITY_RAW_HTML_INJECTION;
        violations.push({
          filePath: relativePath,
          line: lineNum,
          column: 1,
          hazard: 'Unsanitized HTML injection via v-html detected without DOMPurify',
          rule: 'SECURITY_RAW_HTML_INJECTION',
          severity: meta.severity,
          pillar: meta.pillar,
          directive: meta.directive
        });
      }
    }

    // Pillar 8: Non-semantic clickable containers in templates (@click on div/span)
    const hasClickableContainer = isTemplateFile && CLICKABLE_CONTAINER_PATTERN.test(lineText);
    if (hasClickableContainer) {
      const meta = RULE_REGISTRY.A11Y_CLICKABLE_NON_SEMANTIC;
      violations.push({
        filePath: relativePath,
        line: lineNum,
        column: 1,
        hazard: 'Clickable generic container detected without native button/link semantics',
        rule: 'A11Y_CLICKABLE_NON_SEMANTIC',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
    }

    // Pillar 8: Missing alt attribute on img tags
    const hasMissingAltImg = isTemplateFile && IMG_WITHOUT_ALT_PATTERN.test(lineText);
    if (hasMissingAltImg) {
      const meta = RULE_REGISTRY.A11Y_IMAGE_MISSING_ALT;
      violations.push({
        filePath: relativePath,
        line: lineNum,
        column: 1,
        hazard: 'Image element missing alt text attribute',
        rule: 'A11Y_IMAGE_MISSING_ALT',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
    }

    // Pillar 10: Fake green tests (only in spec/test files)
    const canCheckFakeGreen = isTestFile && !isComment;
    if (canCheckFakeGreen) {
      for (const pat of FAKE_GREEN_PATTERNS) {
        const isFakeGreenMatch = pat.test(lineText);
        if (isFakeGreenMatch) {
          const meta = RULE_REGISTRY.TEST_FAKE_GREEN;
          violations.push({
            filePath: relativePath,
            line: lineNum,
            column: 1,
            hazard: 'Fake green test assertion detected (asserting literal against itself)',
            rule: 'TEST_FAKE_GREEN',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
          break;
        }
      }
    }
  });
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
