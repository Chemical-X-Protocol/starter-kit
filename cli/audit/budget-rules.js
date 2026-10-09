/**
 * LINE_BUDGET_FILE, LINE_BUDGET_MOLECULE and VIEW_MONOLITH from the one budget
 * policy in line-budgets.js (finding line-budget-chaos).
 */
import { PILLARS } from './rules-registry.js';
import {
  countLines,
  getLineBudgets,
  resolveFileTier,
  isViewMarkupFile
} from './line-budgets.js';

const fileViolation = (relativePath, rule, severity, hazard, directive) => ({
  filePath: relativePath,
  line: 1,
  column: 1,
  hazard,
  rule,
  severity,
  pillar: PILLARS.PILLAR_1,
  directive
});

const resolveFileSeverity = (lineCount, budget) => {
  if (lineCount >= budget.critical) return { severity: 'CRITICAL', limit: budget.critical, label: 'Extreme monolith hazard' };
  if (lineCount >= budget.high) return { severity: 'HIGH', limit: budget.high, label: 'Severe monolith hazard' };
  return { severity: 'MEDIUM', limit: budget.warn, label: 'Monolith line budget warning' };
};

const resolveMoleculeSeverity = (lineCount, limit) => {
  if (lineCount >= limit * 5) return 'CRITICAL';
  if (lineCount >= limit * 2.5) return 'HIGH';
  return 'MEDIUM';
};

const resolveTemplateLines = (content, sfc) => {
  const template = sfc?.template;
  if (template) return template.endLine - template.startLine + 1;
  return countLines(content);
};

/**
 * @param {{ content: string, relativePath: string, config?: object, sfc?: object|null, hasHighComplexity?: boolean }} input
 */
export const checkLineBudgets = ({ content, relativePath, config = {}, sfc = null, hasHighComplexity = false }) => {
  const budgets = getLineBudgets(config);
  const lineCount = countLines(content);
  const tier = resolveFileTier(relativePath, config);

  const isFileMonolith = lineCount > budgets.file.warn;
  if (isFileMonolith) {
    const { severity, limit, label } = resolveFileSeverity(lineCount, budgets.file);
    return [fileViolation(relativePath, 'LINE_BUDGET_FILE', severity, `${label} (${lineCount} > ${limit} lines)`,
      'Decompose monolith into domain capsules and molecules (Directive 1.A)')];
  }

  const isOverMoleculeBudget = tier === 'molecule' && lineCount > budgets.molecule;
  const isMoleculeEnforced = budgets.isMoleculeHardCap || hasHighComplexity;
  if (isOverMoleculeBudget && isMoleculeEnforced) {
    const severity = resolveMoleculeSeverity(lineCount, budgets.molecule);
    return [fileViolation(relativePath, 'LINE_BUDGET_MOLECULE', severity, `Molecule capsule over budget (${lineCount} > ${budgets.molecule} lines, ${budgets.profile})`,
      'Split molecule into focused sub-molecules or extract state to a composable (Directive 1.C)')];
  }

  const isViewEntry = tier === 'view' && isViewMarkupFile(relativePath);
  const templateLines = isViewEntry ? resolveTemplateLines(content, sfc) : 0;
  const isViewMonolith = templateLines > budgets.viewTemplate.warn;
  if (isViewMonolith) {
    const isSevere = templateLines >= budgets.viewTemplate.critical;
    return [fileViolation(relativePath, 'VIEW_MONOLITH', isSevere ? 'CRITICAL' : 'MEDIUM',
      `View template over budget (${templateLines} > ${budgets.viewTemplate.warn} lines)`,
      'Refactor top-level view to a 10 to 20 line Table of Contents (Directive 1.B)')];
  }
  return [];
};
