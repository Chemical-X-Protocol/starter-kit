import * as t from '@babel/types';
import { RULE_REGISTRY } from './rules-registry.js';
import { parseSfc } from '../sfc/sfc-parse.js';

export const countLogicalOperators = (node) => {
  let count = 0;
  if (t.isLogicalExpression(node)) {
    count += 1;
    count += countLogicalOperators(node.left);
    count += countLogicalOperators(node.right);
  } else if (t.isUnaryExpression(node) && node.operator === '!') {
    count += 1;
    count += countLogicalOperators(node.argument);
  }
  return count;
};

/**
 * Babel-parsable code for a file. For .vue this is the shared SFC script overlay:
 * every <script> block in place, everything else blanked, so lines match the file.
 */
export const extractParseableCode = (content, ext, filePath = 'component.vue') => {
  if (ext === '.vue') return parseSfc(content, filePath).scriptOverlay;
  return content;
};

export const checkTypographyEmDash = (content, lines, relativePath, violations) => {
  if (!content.includes('\u2014')) return;
  lines.forEach((lineText, idx) => {
    if (lineText.includes('\u2014')) {
      const ruleMeta = RULE_REGISTRY.TYPOGRAPHY_EM_DASH;
      violations.push({
        filePath: relativePath,
        line: idx + 1,
        column: lineText.indexOf('\u2014') + 1,
        hazard: 'Em dash detected in source code or copy',
        rule: 'TYPOGRAPHY_EM_DASH',
        severity: ruleMeta.severity,
        pillar: ruleMeta.pillar,
        directive: ruleMeta.directive
      });
    }
  });
};

export const checkMockDataPatterns = (content, lines, relativePath, violations) => {
  const mockEmailRegex = /['"][a-zA-Z0-9._%+-]+@(example\.com|test\.com|gmail\.com|foo\.bar)['"]/g;
  const mockPhoneRegex = /['"]555-\d{3,4}['"]/g;

  lines.forEach((lineText, idx) => {
    const hasMockEmail = mockEmailRegex.test(lineText);
    const hasMockPhone = mockPhoneRegex.test(lineText);
    if (hasMockEmail || hasMockPhone) {
      const ruleMeta = RULE_REGISTRY.SYNTHETIC_MOCK_DATA;
      violations.push({
        filePath: relativePath,
        line: idx + 1,
        column: 1,
        hazard: 'Hardcoded synthetic mock data pattern detected',
        rule: 'SYNTHETIC_MOCK_DATA',
        severity: ruleMeta.severity,
        pillar: ruleMeta.pillar,
        directive: ruleMeta.directive
      });
    }
  });
};

/**
 * Executes a synchronous operation returning a Go/Rust-style [data, error] tuple.
 * @template T
 * @param {() => T} operation
 * @returns {[T, null] | [null, Error]}
 */
export const toResultSync = (operation) => {
  try {
    const value = operation();
    return [value, null];
  } catch (err) {
    const normalizedError = err instanceof Error ? err : new Error(String(err));
    return [null, normalizedError];
  }
};
