import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import path from 'node:path';
import { PILLARS, RULE_REGISTRY } from './rules-registry.js';
import {
  extractParseableCode,
  checkTypographyEmDash,
  checkMockDataPatterns,
  resolveMonolithTier,
  resolveMoleculeTier
} from './rules-helpers.js';
import { createAstVisitors } from './ast-visitors.js';
import {
  checkSlopTextPatterns,
  createAiSlopVisitors
} from './ai-slop-detector.js';

export { PILLARS, RULE_REGISTRY };

export const auditCode = (content, filePath, relativePath) => {
  const violations = [];
  const lines = content.split('\n');
  const lineCount = lines.length;
  const ext = path.extname(filePath);
  const baseName = path.basename(filePath);

  const isMolecule = relativePath.includes('molecules') || relativePath.includes('/m-') || baseName.startsWith('m-');
  const isView = relativePath.includes('/views/') || relativePath.includes('/pages/') || /View\.[tj]sx?$/.test(baseName);
  const isRootTypeFile = baseName === 'types.ts' || baseName === 'global.d.ts';

  // Pillar 1: Sliding Scale Monolith Detection
  if (lineCount > 500) {
    const tier = resolveMonolithTier(lineCount);
    violations.push({
      filePath: relativePath,
      line: 1,
      column: 1,
      hazard: tier.hazard,
      rule: 'LINE_BUDGET_FILE',
      severity: tier.severity,
      pillar: PILLARS.PILLAR_1,
      directive: tier.directive
    });
  } else if (isMolecule && lineCount > 100) {
    const tier = resolveMoleculeTier(lineCount);
    violations.push({
      filePath: relativePath,
      line: 1,
      column: 1,
      hazard: tier.hazard,
      rule: 'LINE_BUDGET_MOLECULE',
      severity: tier.severity,
      pillar: PILLARS.PILLAR_1,
      directive: tier.directive
    });
  } else if (isView && lineCount > 200) {
    const isSevere = lineCount >= 500;
    const severity = isSevere ? 'CRITICAL' : 'MEDIUM';
    const hazardLabel = isSevere
      ? `Extreme view monolith (${lineCount} >= 500 lines)`
      : `View template budget warning (${lineCount} > 200 lines)`;

    violations.push({
      filePath: relativePath,
      line: 1,
      column: 1,
      hazard: hazardLabel,
      rule: 'VIEW_MONOLITH',
      severity,
      pillar: PILLARS.PILLAR_1,
      directive: 'Refactor top-level view to a 10 to 20 line Table of Contents'
    });
  }

  // Pillar 4: Type Monolith
  if (isRootTypeFile && lineCount > 150) {
    const meta = RULE_REGISTRY.TYPE_MONOLITH;
    violations.push({
      filePath: relativePath,
      line: 1,
      column: 1,
      hazard: `Root type file monolith detected (${lineCount} > 150 lines)`,
      rule: 'TYPE_MONOLITH',
      severity: meta.severity,
      pillar: meta.pillar,
      directive: meta.directive
    });
  }

  // Pillar 7: Typography & Mock Data Fast Checks
  checkTypographyEmDash(content, lines, relativePath, violations);
  checkMockDataPatterns(content, lines, relativePath, violations);

  // AI Slop Fast Checks (conversational residue, code fences, echo comments)
  checkSlopTextPatterns(content, lines, relativePath, violations);

  const codeToParse = extractParseableCode(content, ext);
  if (!codeToParse.trim()) {
    return violations;
  }

  let ast;
  try {
    ast = parse(codeToParse, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx']
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const meta = RULE_REGISTRY.SYNTAX_PARSE_ERROR;
    violations.push({
      filePath: relativePath,
      line: 1,
      column: 1,
      hazard: `Parse error: ${errorMsg}`,
      rule: 'SYNTAX_PARSE_ERROR',
      severity: meta.severity,
      pillar: meta.pillar,
      directive: meta.directive
    });
    return violations;
  }

  const traverseFn = traverse.default || traverse;
  const visitors = createAstVisitors({ relativePath, violations });
  const slopVisitors = createAiSlopVisitors({ relativePath, violations });

  const mergedVisitors = { ...visitors };
  for (const [key, fn] of Object.entries(slopVisitors)) {
    if (mergedVisitors[key]) {
      const orig = mergedVisitors[key];
      mergedVisitors[key] = (p, s) => {
        orig(p, s);
        fn(p, s);
      };
    } else {
      mergedVisitors[key] = fn;
    }
  }

  traverseFn(ast, mergedVisitors);

  return violations;
};
