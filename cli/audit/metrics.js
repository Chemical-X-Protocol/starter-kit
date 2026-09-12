import { PILLARS } from './rules.js';

export const calculateMolecularHealthScore = (violations, totalFiles) => {
  if (totalFiles === 0) {
    return { score: 100, grade: 'A+', label: 'Crystalline Molecular' };
  }

  let penalty = 0;
  for (const v of violations) {
    if (v.isAiSlop) continue;
    if (v.severity === 'CRITICAL') penalty += 8;
    else if (v.severity === 'HIGH') penalty += 4;
    else if (v.severity === 'MEDIUM') penalty += 2;
    else if (v.severity === 'LOW') penalty += 1;
  }

  // Normalize penalty against codebase size
  const scale = Math.max(1, Math.log10(totalFiles + 1));
  const adjustedPenalty = penalty / scale;
  const score = Math.max(0, Math.min(100, Math.round(100 - adjustedPenalty)));

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

  return { score, grade, label };
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
    if (v.isAiSlop) continue;
    const pillarName = v.pillar || PILLARS.PILLAR_1;
    if (!breakdown[pillarName]) {
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
    if (item.critical > 0) {
      item.status = 'FAILED';
    } else if (item.high > 0 || item.medium > 1) {
      item.status = 'WARN';
    } else {
      item.status = 'PASSED';
    }
  }

  return breakdown;
};

export const MODEL_PRICING_RATES = {
  blended: { name: 'Frontier Blended ($3.00/1M)', costPerMillion: 3.0 },
  claude: { name: 'Claude 3.5 Sonnet ($3.00/1M)', costPerMillion: 3.0 },
  gpt4o: { name: 'GPT-4o ($2.50/1M)', costPerMillion: 2.5 }
};

export const calculateTokenBurnAnalytics = (fileStats, options = {}) => {
  let totalRawChars = 0;
  let excessChars = 0;

  for (const f of fileStats) {
    totalRawChars += f.charCount;
    // Budget: 500 lines max for files (~18,000 chars), 100 lines for molecules (~3,600 chars)
    const maxChars = f.isMolecule ? 3600 : 18000;
    if (f.charCount > maxChars) {
      excessChars += f.charCount - maxChars;
    }
  }

  const estimatedTokens = Math.round(totalRawChars / 3.8);
  const estimatedExcessTokens = Math.round(excessChars / 3.8);
  const potentialSavingsPct = totalRawChars > 0
    ? Math.min(85, Math.round((excessChars / totalRawChars) * 100))
    : 0;

  const resolveRiskLevel = (pct) => {
    if (pct > 40) return 'HIGH';
    if (pct > 15) return 'MODERATE';
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

const resolveMonolithTierName = (lineCount) => {
  if (lineCount >= 2000) return 'CRITICAL';
  if (lineCount >= 1000) return 'SEVERE';
  if (lineCount > 500) return 'WARNING';
  return null;
};

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
      isMonolith: stats.lineCount > 500,
      monolithTier
    };
  });

  scoredFiles.sort((a, b) => b.violationCount - a.violationCount || b.lineCount - a.lineCount);
  return scoredFiles.slice(0, limit);
};

export const calculateQuantumHealthScore = calculateMolecularHealthScore;

export const calculateAiSlopScore = (violations, totalFiles) => {
  const slopViolations = violations.filter((v) => v.isAiSlop);
  if (totalFiles === 0) {
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

  const scale = Math.max(1, Math.log10(totalFiles + 1));
  const adjustedPenalty = penalty / scale;
  const score = Math.max(0, Math.min(100, Math.round(100 - adjustedPenalty)));

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
