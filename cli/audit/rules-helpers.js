import * as t from '@babel/types';
import { RULE_REGISTRY } from './rules-registry.js';

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

export const extractParseableCode = (content, ext) => {
  if (ext === '.vue') {
    const scriptMatch = content.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
    return scriptMatch ? scriptMatch[1] : '';
  }
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

export const resolveMonolithTier = (lineCount) => {
  if (lineCount >= 2000) {
    return {
      severity: 'CRITICAL',
      hazard: `Extreme monolith hazard (${lineCount} >= 2,000 lines)`,
      directive: 'Immediate decomposition required: extreme monolith induces severe agent context degradation'
    };
  }
  if (lineCount >= 1000) {
    return {
      severity: 'HIGH',
      hazard: `Severe monolith hazard (${lineCount} >= 1,000 lines)`,
      directive: 'Decompose file into domain capsules and molecules to prevent context degradation'
    };
  }
  return {
    severity: 'MEDIUM',
    hazard: `Monolith line budget warning (${lineCount} > 500 lines)`,
    directive: 'Plan decomposition into focused modules before file grows further'
  };
};

export const resolveMoleculeTier = (lineCount) => {
  if (lineCount >= 500) {
    return {
      severity: 'CRITICAL',
      hazard: `Extreme molecule monolith (${lineCount} >= 500 lines)`,
      directive: 'Decompose molecule capsule into smaller sub-molecules or extract state to hooks'
    };
  }
  if (lineCount >= 250) {
    return {
      severity: 'HIGH',
      hazard: `Oversized molecule capsule (${lineCount} >= 250 lines)`,
      directive: 'Decompose molecule capsule into smaller sub-molecules or extract state to hooks'
    };
  }
  return {
    severity: 'MEDIUM',
    hazard: `Molecule capsule budget warning (${lineCount} > 100 lines)`,
    directive: 'Split molecule into focused sub-molecules or extract state to hook'
  };
};
