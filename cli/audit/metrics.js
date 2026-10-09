import { classifyFileSize, getLineBudgets } from './line-budgets.js';
import { PILLARS } from './rules.js';

export const isSlopViolation = (v) => Boolean(v.isAiSlop || (v.rule && v.rule.startsWith('AI_SLOP_')));

/**
 * Score model 2 (intensive): the score depends on weighted violations per file, so
 * a 10-file and a 1,000-file codebase with the same density earn the same grade.
 * Model 1 divided by log10(files), which grew penalties with codebase size.
 */
export const SCORE_MODEL = 2;
const SEVERITY_WEIGHTS = { CRITICAL: 8, HIGH: 4, MEDIUM: 2, LOW: 1 };
const DENSITY_SCALE = 1.5;
const CHARS_PER_LINE = 36;

export const calculateWeightedDensity = (violations, totalFiles) => {
  const penalty = violations.reduce((sum, v) => sum + (SEVERITY_WEIGHTS[v.severity] ?? 1), 0);
  return penalty / Math.max(1, totalFiles);
};

export const scoreFromDensity = (density) => Math.max(0, Math.min(100, Math.round(100 - DENSITY_SCALE * density)));

export const calculateMolecularHealthScore = (violations, totalFiles) => {
  const isEmpty = totalFiles === 0;
  if (isEmpty) {
    return { score: 100, grade: 'A+', label: 'Crystalline Molecular', scoreModel: SCORE_MODEL, density: 0 };
  }

  const density = calculateWeightedDensity(violations.filter((v) => !isSlopViolation(v)), totalFiles);
  const score = scoreFromDensity(density);

  let grade = 'F';
  let label = 'Severe Context Rot';

  if (score >= 95) {
    grade = 'A+';
    label = 'Crystalline Molecular';
  } else if (score >= 90) {
    grade = 'A';
    label = 'Highly Modular';
  } else if (score >= 80) {
    grade = 'B';
    label = 'Moderately Modular';
  } else if (score >= 70) {
    grade = 'C';
    label = 'Monolithic Drift';
  } else if (score >= 60) {
    grade = 'D';
    label = 'High Context Hazard';
  }

  return { score, grade, label, scoreModel: SCORE_MODEL, density: Number(density.toFixed(2)) };
};

export const calculatePillarBreakdown = (violations) => {
  const breakdown = {};
  for (const [key, name] of Object.entries(PILLARS)) {
    breakdown[name] = {
      pillarKey: key,
      violations: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      status: 'PASSED'
    };
  }

  for (const v of violations) {
    if (isSlopViolation(v)) continue;
    const pillarName = v.pillar || PILLARS.PILLAR_1;
    const hasPillar = Boolean(breakdown[pillarName]);
    if (!hasPillar) {
      breakdown[pillarName] = {
        pillarKey: 'UNKNOWN',
        violations: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        status: 'PASSED'
      };
    }
    const item = breakdown[pillarName];
    item.violations += 1;
    if (v.severity === 'CRITICAL') item.critical += 1;
    else if (v.severity === 'HIGH') item.high += 1;
    else if (v.severity === 'MEDIUM') item.medium += 1;
    else if (v.severity === 'LOW') item.low += 1;
  }

  for (const item of Object.values(breakdown)) {
    const hasCritical = item.critical > 0;
    if (hasCritical) {
      item.status = 'FAILED';
    } else {
      const hasWarning = item.high > 0 || item.medium > 1;
      if (hasWarning) {
        item.status = 'WARN';
      } else {
        item.status = 'PASSED';
      }
    }
  }

  return breakdown;
};

export const MODEL_PRICING_RATES = {
  blended: { name: 'Frontier Blended ($3.00/1M)', costPerMillion: 3.0 },
  claude: { name: 'Claude 3.5 Sonnet ($3.00/1M)', costPerMillion: 3.0 },
  gpt4o: { name: 'GPT-4o ($2.50/1M)', costPerMillion: 2.5 }
};

/** For fileStats built without a lineBudget: the default profile's budget for the file's tier. */
const fallbackLineBudget = (f) => {
  const budgets = getLineBudgets();
  return f.isMolecule ? budgets.molecule : budgets.file.warn;
};

export const calculateTokenBurnAnalytics = (fileStats, options = {}) => {
  let totalRawChars = 0;
  let excessChars = 0;

  for (const f of fileStats) {
    totalRawChars += f.charCount;
    // Budget from the line-budget policy (about 36 chars per line).
    const lineBudget = f.lineBudget ?? fallbackLineBudget(f);
    const maxChars = lineBudget * CHARS_PER_LINE;
    const hasExcess = f.charCount > maxChars;
    if (hasExcess) {
      excessChars += f.charCount - maxChars;
    }
  }

  const estimatedTokens = Math.round(totalRawChars / 3.8);
  const estimatedExcessTokens = Math.round(excessChars / 3.8);
  const potentialSavingsPct = totalRawChars > 0
    ? Math.min(85, Math.round((excessChars / totalRawChars) * 100))
    : 0;

  const resolveRiskLevel = (pct) => {
    const isHigh = pct > 40;
    if (isHigh) return 'HIGH';
    const isModerate = pct > 15;
    if (isModerate) return 'MODERATE';
    return 'LOW';
  };

  const selectedModel = options?.model?.toLowerCase() || 'blended';
  const modelConfig = MODEL_PRICING_RATES[selectedModel] || MODEL_PRICING_RATES.blended;
  const costPerMillion = options?.costPerMillion ? Number(options.costPerMillion) : modelConfig.costPerMillion;

  const excessCostPerPass = Number(((estimatedExcessTokens / 1000000) * costPerMillion).toFixed(3));
  const weeklyWastePerDev = Number((excessCostPerPass * 20 * 5).toFixed(2));
  const monthlyWastePerDev = Number((weeklyWastePerDev * 4).toFixed(2));

  return {
    estimatedTokens,
    estimatedExcessTokens,
    potentialSavingsPct,
    riskLevel: resolveRiskLevel(potentialSavingsPct),
    pricingModel: modelConfig.name,
    costPerMillion,
    excessCostPerPass,
    weeklyWastePerDev,
    monthlyWastePerDev
  };
};

const MONOLITH_TIER_NAMES = Object.freeze({ extreme: 'CRITICAL', severe: 'SEVERE', warning: 'WARNING' });

const resolveMonolithTierName = (lineCount) => MONOLITH_TIER_NAMES[classifyFileSize(lineCount)] ?? null;

export const calculateHotspots = (violations, fileStats, limit = 5) => {
  const violationCountsByFile = {};
  for (const v of violations) {
    violationCountsByFile[v.filePath] = (violationCountsByFile[v.filePath] || 0) + 1;
  }

  const fileMap = {};
  for (const f of fileStats) {
    fileMap[f.relativePath] = f;
  }

  const scoredFiles = Object.entries(violationCountsByFile).map(([filePath, count]) => {
    const stats = fileMap[filePath] || { lineCount: 0 };
    const monolithTier = resolveMonolithTierName(stats.lineCount);

    return {
      filePath,
      violationCount: count,
      lineCount: stats.lineCount,
      isMonolith: classifyFileSize(stats.lineCount) !== null,
      monolithTier
    };
  });

  scoredFiles.sort((a, b) => b.violationCount - a.violationCount || b.lineCount - a.lineCount);
  return scoredFiles.slice(0, limit);
};

export const calculateQuantumHealthScore = calculateMolecularHealthScore;

export const calculateAiSlopScore = (violations, totalFiles) => {
  const slopViolations = violations.filter(isSlopViolation);
  const isEmpty = totalFiles === 0;
  if (isEmpty) {
    return {
      score: 100,
      grade: 'A+',
      label: 'Pure Artisanal',
      violationsCount: 0,
      breakdown: { critical: 0, high: 0, medium: 0, low: 0 }
    };
  }

  let penalty = 0;
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const v of slopViolations) {
    if (v.severity === 'CRITICAL') {
      penalty += 10;
      critical += 1;
    } else if (v.severity === 'HIGH') {
      penalty += 5;
      high += 1;
    } else if (v.severity === 'MEDIUM') {
      penalty += 2;
      medium += 1;
    } else {
      penalty += 1;
      low += 1;
    }
  }

  const score = scoreFromDensity(penalty / Math.max(1, totalFiles));

  let grade = 'F';
  let label = 'Severe AI Slop Infection';

  if (score >= 95) {
    grade = 'A+';
    label = 'Pure Artisanal';
  } else if (score >= 90) {
    grade = 'A';
    label = 'Near-Zero Slop';
  } else if (score >= 80) {
    grade = 'B';
    label = 'Low AI Residue';
  } else if (score >= 70) {
    grade = 'C';
    label = 'Moderate Slop Drift';
  } else if (score >= 60) {
    grade = 'D';
    label = 'High AI Slop Hazard';
  }

  return {
    score,
    grade,
    label,
    violationsCount: slopViolations.length,
    breakdown: { critical, high, medium, low }
  };
};
