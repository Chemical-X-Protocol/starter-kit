import fs from 'node:fs';
import path from 'node:path';
import { RULE_REGISTRY } from './rules-registry.js';
import { toResultSync } from './rules-helpers.js';
import {
  isComponentExtension,
  isTemplateExtension,
  isCommentLine
} from './rules-predicates.js';

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
const TABNABBING_TEMPLATE_PATTERN = /<a\b[^>]*\btarget\s*=\s*["']_blank["'][^>]*>/i;
const JAVASCRIPT_URL_TEMPLATE_PATTERN = /\b(?:href|src|action|formaction)\s*=\s*["']\s*javascript:/i;

/**
 * Pillar 10: Check for co-located test files for molecule capsules.
 */
export const checkMoleculeCoLocatedTest = (filePath, relativePath, violations) => {
  const baseName = path.basename(filePath);
  const ext = path.extname(filePath);

  // Stage 1: Atomic Concept Declarations
  const isMoleculePath = relativePath.includes('molecules') || baseName.startsWith('m-');
  const isComponentExt = isComponentExtension(ext);
  const isTestOrSpecFile = baseName.includes('.spec.') || baseName.includes('.test.');

  // Stage 2: Unified Decision Variable & Early Guard Clause
  const isCandidateComponent = isMoleculePath && isComponentExt;
  const isMoleculeComponent = isCandidateComponent && !isTestOrSpecFile;
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
  const isTemplateFile = isTemplateExtension(ext);

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;
    const trimmed = lineText.trim();
    const isComment = isCommentLine(trimmed);

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

    // Pillar 9: Reverse Tabnabbing in HTML / Vue templates
    const hasTargetBlank = isTemplateFile && TABNABBING_TEMPLATE_PATTERN.test(lineText);
    if (hasTargetBlank) {
      const hasRelProtection = /\brel\s*=\s*["'][^"']*(?:noopener|noreferrer)[^"']*["']/i.test(lineText);
      if (!hasRelProtection) {
        const meta = RULE_REGISTRY.SECURITY_REVERSE_TABNABBING;
        violations.push({
          filePath: relativePath,
          line: lineNum,
          column: 1,
          hazard: 'External link with target="_blank" missing rel="noopener noreferrer"',
          rule: 'SECURITY_REVERSE_TABNABBING',
          severity: meta.severity,
          pillar: meta.pillar,
          directive: meta.directive
        });
      }
    }

    // Pillar 9: javascript: pseudo-protocol in HTML / Vue templates
    const hasJsUrl = isTemplateFile && JAVASCRIPT_URL_TEMPLATE_PATTERN.test(lineText);
    if (hasJsUrl) {
      const meta = RULE_REGISTRY.SECURITY_JAVASCRIPT_URL;
      violations.push({
        filePath: relativePath,
        line: lineNum,
        column: 1,
        hazard: 'javascript: pseudo-protocol detected in template attribute',
        rule: 'SECURITY_JAVASCRIPT_URL',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
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
