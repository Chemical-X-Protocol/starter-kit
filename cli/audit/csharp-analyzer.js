/**
 * Chemical X C# / .NET Structural Analyzer
 * Evaluates .NET Clean Architecture, MediatR handlers, EF Core usage, and AI slop.
 */
import { RULE_REGISTRY } from './rules-registry.js';

const SHALLOW_CATCH_PATTERN = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*)?\s*\}/;
const IN_MEMORY_DB_PATTERN = /\bUseInMemoryDatabase\s*\(/;
const SIMULATED_DELAY_PATTERN = /\bTask\.Delay\s*\(\s*\d+\s*\)/;
const HARDCODED_LIST_MOCK_PATTERN = /new\s+List<[A-Za-z0-9_]+>\s*\{\s*new\s+[A-Za-z0-9_]+\s*\{/;

export const analyzeCSharpCode = (content, relativePath, violations) => {
  const lines = content.split('\n');

  // Multi-line and single-line shallow catch detection
  const catchMatches = content.matchAll(/catch\s*(?:\([^)]*\))?\s*\{(?:\s*|\s*\/\/[^\n]*\s*)\}/g);
  for (const m of catchMatches) {
    const lineNum = content.slice(0, m.index).split('\n').length;
    const meta = RULE_REGISTRY.AI_SLOP_SHALLOW_CATCH;
    violations.push({
      filePath: relativePath,
      line: lineNum,
      column: 1,
      hazard: 'Empty or shallow catch block detected in C# handler/service',
      rule: 'AI_SLOP_SHALLOW_CATCH',
      severity: meta.severity,
      pillar: meta.pillar,
      directive: meta.directive
    });
  }

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;

    // Simulated Mock Data / Stubs
    if (IN_MEMORY_DB_PATTERN.test(lineText)) {
      const meta = RULE_REGISTRY.SYNTHETIC_MOCK_DATA;
      violations.push({
        filePath: relativePath,
        line: lineNum,
        column: 1,
        hazard: 'UseInMemoryDatabase mock provider detected (unverified live persistence)',
        rule: 'SYNTHETIC_MOCK_DATA',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
    }

    if (SIMULATED_DELAY_PATTERN.test(lineText)) {
      const meta = RULE_REGISTRY.AI_SLOP_LAZY_PLACEHOLDER;
      violations.push({
        filePath: relativePath,
        line: lineNum,
        column: 1,
        hazard: 'Simulated Task.Delay detected (artificial asynchronous latency stub)',
        rule: 'AI_SLOP_LAZY_PLACEHOLDER',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
    }

    if (HARDCODED_LIST_MOCK_PATTERN.test(lineText)) {
      const meta = RULE_REGISTRY.SYNTHETIC_MOCK_DATA;
      violations.push({
        filePath: relativePath,
        line: lineNum,
        column: 1,
        hazard: 'Hardcoded synthetic entity collection detected in C# service',
        rule: 'SYNTHETIC_MOCK_DATA',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
    }
  });

  return violations;
};
