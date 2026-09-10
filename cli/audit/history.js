import fs from 'node:fs';
import path from 'node:path';
import { groupViolationsBySeverity } from './reporter.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

export const ensureChemxDir = (cwd = process.cwd()) => {
  const dir = path.resolve(cwd, '.chemx');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Ensure .chemx is gitignored if git repo exists
  const gitDir = path.resolve(cwd, '.git');
  if (fs.existsSync(gitDir)) {
    const gitignorePath = path.resolve(cwd, '.gitignore');
    try {
      let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
      if (!content.includes('.chemx')) {
        const trailingNewline = content.endsWith('\n') || content.length === 0 ? '' : '\n';
        fs.appendFileSync(gitignorePath, `${trailingNewline}# Chemical X local telemetry & audit history\n.chemx/\n`, 'utf-8');
      }
    } catch {}
  }

  return dir;
};

export const createSnapshotFromReport = (report) => {
  const { metrics, health, hotspots = [], violations = [], pillars = {}, contextAnalysis = {} } = report;
  const { critical, high, medium, low } = groupViolationsBySeverity(violations);

  const extremeMonoliths = hotspots.filter((h) => h.lineCount >= 2000).length;
  const severeMonoliths = hotspots.filter((h) => h.lineCount >= 1000 && h.lineCount < 2000).length;
  const warningMonoliths = hotspots.filter((h) => h.lineCount >= 500 && h.lineCount < 1000).length;
  const totalMonoliths = extremeMonoliths + severeMonoliths + warningMonoliths;

  const pillarSummaries = {};
  for (const [key, data] of Object.entries(pillars)) {
    pillarSummaries[key] = {
      status: data.status,
      violations: data.violations,
      critical: data.critical
    };
  }

  return {
    id: `audit-${Date.now()}`,
    timestamp: new Date().toISOString(),
    health: {
      score: health.score,
      grade: health.grade,
      label: health.label
    },
    metrics: {
      scannedFiles: metrics.scannedFiles,
      totalLoc: metrics.totalLoc,
      avgLoc: metrics.avgLoc,
      moleculeCount: metrics.moleculeCount,
      moleculeCompliantCount: metrics.moleculeCompliantCount,
      moleculeCompliantPct: metrics.moleculeCompliantPct,
      hookCount: metrics.hookCount
    },
    violations: {
      total: violations.length,
      critical: critical.length,
      high: high.length,
      medium: medium.length,
      low: low.length
    },
    monoliths: {
      total: totalMonoliths,
      extreme: extremeMonoliths,
      severe: severeMonoliths,
      warning: warningMonoliths
    },
    tokens: {
      estimatedTokens: contextAnalysis.estimatedTokens || 0,
      estimatedExcessTokens: contextAnalysis.estimatedExcessTokens || 0,
      potentialSavingsPct: contextAnalysis.potentialSavingsPct || 0,
      riskLevel: contextAnalysis.riskLevel || 'LOW'
    },
    pillars: pillarSummaries
  };
};

export const getAuditHistory = (cwd = process.cwd()) => {
  const historyPath = path.resolve(cwd, '.chemx', 'history.json');
  if (!fs.existsSync(historyPath)) return [];
  try {
    const raw = fs.readFileSync(historyPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const getAuditBaseline = (cwd = process.cwd()) => {
  const baselinePath = path.resolve(cwd, '.chemx', 'baseline.json');
  if (fs.existsSync(baselinePath)) {
    try {
      const raw = fs.readFileSync(baselinePath, 'utf-8');
      return JSON.parse(raw);
    } catch {}
  }
  const history = getAuditHistory(cwd);
  return history.length > 0 ? history[0] : null;
};

export const setAuditBaseline = (snapshot, cwd = process.cwd()) => {
  ensureChemxDir(cwd);
  const baselinePath = path.resolve(cwd, '.chemx', 'baseline.json');
  fs.writeFileSync(baselinePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  return snapshot;
};

export const saveAuditSnapshot = (report, cwd = process.cwd()) => {
  ensureChemxDir(cwd);
  const snapshot = createSnapshotFromReport(report);
  const history = getAuditHistory(cwd);

  // Prevent duplicate snapshots if called multiple times within 5 seconds with same metrics
  if (history.length > 0) {
    const last = history[history.length - 1];
    const timeDiff = Math.abs(Date.now() - new Date(last.timestamp).getTime());
    const isSameMetrics =
      last.health?.score === snapshot.health?.score &&
      last.metrics?.totalLoc === snapshot.metrics?.totalLoc &&
      last.violations?.total === snapshot.violations?.total;

    if (timeDiff < 5000 && isSameMetrics) {
      return {
        snapshot: last,
        history,
        baseline: getAuditBaseline(cwd),
        isNewBaseline: false,
        totalAudits: history.length
      };
    }
  }

  history.push(snapshot);

  // Keep last 50 snapshots
  const trimmed = history.slice(-50);
  const historyPath = path.resolve(cwd, '.chemx', 'history.json');
  fs.writeFileSync(historyPath, JSON.stringify(trimmed, null, 2), 'utf-8');

  // Auto-establish first run as baseline if none exists
  const baselinePath = path.resolve(cwd, '.chemx', 'baseline.json');
  let isNewBaseline = false;
  if (!fs.existsSync(baselinePath)) {
    fs.writeFileSync(baselinePath, JSON.stringify(snapshot, null, 2), 'utf-8');
    isNewBaseline = true;
  }

  const baseline = getAuditBaseline(cwd);
  return {
    snapshot,
    history: trimmed,
    baseline,
    isNewBaseline,
    totalAudits: trimmed.length
  };
};

export const calculateTransformationDelta = (beforeSnapshot, afterSnapshot) => {
  const scoreBefore = beforeSnapshot.health.score;
  const scoreAfter = afterSnapshot.health.score;
  const scoreDelta = scoreAfter - scoreBefore;

  const critBefore = beforeSnapshot.violations.critical;
  const critAfter = afterSnapshot.violations.critical;
  const critDelta = critAfter - critBefore;

  const totalBefore = beforeSnapshot.violations.total;
  const totalAfter = afterSnapshot.violations.total;
  const totalDelta = totalAfter - totalBefore;

  const monolithBefore = beforeSnapshot.monoliths.total;
  const monolithAfter = afterSnapshot.monoliths.total;
  const monolithDelta = monolithAfter - monolithBefore;

  const tokensBefore = beforeSnapshot.tokens.estimatedExcessTokens;
  const tokensAfter = afterSnapshot.tokens.estimatedExcessTokens;
  const tokensDelta = tokensAfter - tokensBefore;

  const pillarDeltas = {};
  const allPillars = new Set([
    ...Object.keys(beforeSnapshot.pillars || {}),
    ...Object.keys(afterSnapshot.pillars || {})
  ]);

  for (const pillar of allPillars) {
    const bPillar = beforeSnapshot.pillars?.[pillar] || { status: 'UNKNOWN', violations: 0 };
    const aPillar = afterSnapshot.pillars?.[pillar] || { status: 'UNKNOWN', violations: 0 };
    pillarDeltas[pillar] = {
      beforeStatus: bPillar.status,
      afterStatus: aPillar.status,
      beforeViolations: bPillar.violations,
      afterViolations: aPillar.violations,
      improved: aPillar.violations < bPillar.violations || (bPillar.status !== 'PASSED' && aPillar.status === 'PASSED')
    };
  }

  return {
    scoreDelta,
    critDelta,
    totalDelta,
    monolithDelta,
    tokensDelta,
    pillarDeltas,
    isImproved: scoreDelta > 0 || critDelta < 0 || totalDelta < 0
  };
};

export const formatTransformationTerminal = (beforeSnapshot, afterSnapshot) => {
  const delta = calculateTransformationDelta(beforeSnapshot, afterSnapshot);
  const lines = [];

  const formatDeltaNumber = (val, invertPositiveGood = false) => {
    if (val === 0) return `${DIM}0 (No change)${RESET}`;
    const isGood = invertPositiveGood ? val < 0 : val > 0;
    const sign = val > 0 ? `+${val}` : `${val}`;
    const color = isGood ? GREEN : RED;
    return `${color}${BOLD}${sign}${RESET}`;
  };

  lines.push('');
  lines.push(`${CYAN}======================================================================${RESET}`);
  lines.push(`${BOLD}${CYAN}   ARCHITECTURAL TRANSFORMATION : BEFORE & AFTER PROGRESSION${RESET}`);
  lines.push(`${DIM}   Comparing baseline snapshot vs. latest refactored audit${RESET}`);
  lines.push(`${CYAN}======================================================================${RESET}`);
  lines.push('');

  const dateBefore = new Date(beforeSnapshot.timestamp).toLocaleDateString();
  const dateAfter = new Date(afterSnapshot.timestamp).toLocaleDateString();

  lines.push(`   ${BOLD}Baseline Audit:${RESET}    ${DIM}${dateBefore} [${beforeSnapshot.id}]${RESET}`);
  lines.push(`   ${BOLD}Latest Audit:${RESET}      ${GREEN}${dateAfter} [${afterSnapshot.id}]${RESET}`);
  lines.push('');

  lines.push(`${BOLD}   METRIC COMPARISON TABLE${RESET}`);
  lines.push(`   ------------------------------------------------------------------`);
  lines.push(`   ${'Metric'.padEnd(26)} ${'Before'.padEnd(16)} ${'After'.padEnd(16)} Delta`);
  lines.push(`   ------------------------------------------------------------------`);

  const scoreBeforeStr = `${beforeSnapshot.health.score} (${beforeSnapshot.health.grade})`;
  const scoreAfterStr = `${afterSnapshot.health.score} (${afterSnapshot.health.grade})`;
  lines.push(`   ${'Molecular Health (MHI)'.padEnd(26)} ${scoreBeforeStr.padEnd(16)} ${scoreAfterStr.padEnd(16)} ${formatDeltaNumber(delta.scoreDelta)}`);

  const critBeforeStr = `${beforeSnapshot.violations.critical}`;
  const critAfterStr = `${afterSnapshot.violations.critical}`;
  lines.push(`   ${'Critical Hazards'.padEnd(26)} ${critBeforeStr.padEnd(16)} ${critAfterStr.padEnd(16)} ${formatDeltaNumber(delta.critDelta, true)}`);

  const totalBeforeStr = `${beforeSnapshot.violations.total}`;
  const totalAfterStr = `${afterSnapshot.violations.total}`;
  lines.push(`   ${'Total Violations'.padEnd(26)} ${totalBeforeStr.padEnd(16)} ${totalAfterStr.padEnd(16)} ${formatDeltaNumber(delta.totalDelta, true)}`);

  const monoBeforeStr = `${beforeSnapshot.monoliths.total}`;
  const monoAfterStr = `${afterSnapshot.monoliths.total}`;
  lines.push(`   ${'Monolith Files (>500 LOC)'.padEnd(26)} ${monoBeforeStr.padEnd(16)} ${monoAfterStr.padEnd(16)} ${formatDeltaNumber(delta.monolithDelta, true)}`);

  const excessBeforeStr = `${beforeSnapshot.tokens.estimatedExcessTokens.toLocaleString()} tok`;
  const excessAfterStr = `${afterSnapshot.tokens.estimatedExcessTokens.toLocaleString()} tok`;
  lines.push(`   ${'Excess Token Burn'.padEnd(26)} ${excessBeforeStr.padEnd(16)} ${excessAfterStr.padEnd(16)} ${formatDeltaNumber(delta.tokensDelta, true)}`);

  lines.push(`   ------------------------------------------------------------------`);
  lines.push('');

  lines.push(`${BOLD}   7-PILLAR PROGRESSION${RESET}`);
  lines.push(`   ------------------------------------------------------------------`);
  for (const [pillar, pDelta] of Object.entries(delta.pillarDeltas)) {
    const arrow = pDelta.improved ? `${GREEN}▲ RESOLVED${RESET}` : pDelta.beforeStatus === pDelta.afterStatus ? `${DIM}━ UNCHANGED${RESET}` : `${RED}▼ DEGRADED${RESET}`;
    lines.push(`   ${pillar.padEnd(28)} ${pDelta.beforeStatus.padEnd(10)} -> ${pDelta.afterStatus.padEnd(10)} ${arrow}`);
  }
  lines.push(`   ------------------------------------------------------------------`);
  lines.push('');

  if (delta.isImproved) {
    lines.push(`   ${GREEN}${BOLD}✔ CODEBASE SIGNIFICANTLY IMPROVED!${RESET}`);
    lines.push(`   Post your transformation story to GitHub Discussions using the Share menu.`);
  } else {
    lines.push(`   ${YELLOW}ℹ Codebase metrics are stable or currently under refactoring.${RESET}`);
  }
  lines.push('');

  return lines.join('\n');
};

export const formatHistoryTimelineTerminal = (history) => {
  const lines = [];
  lines.push('');
  lines.push(`${CYAN}======================================================================${RESET}`);
  lines.push(`${BOLD}${CYAN}   LOCAL AUDIT HISTORY TIMELINE (${history.length} RUNS RECORDED)${RESET}`);
  lines.push(`${DIM}   Persistent snapshots stored in .chemx/history.json${RESET}`);
  lines.push(`${CYAN}======================================================================${RESET}`);
  lines.push('');

  if (history.length === 0) {
    lines.push('   No historical audits recorded yet.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`   ${'#'.padEnd(4)} ${'Date/Time'.padEnd(22)} ${'Score'.padEnd(12)} ${'Grade'.padEnd(10)} ${'Monoliths'.padEnd(12)} Hazards`);
  lines.push(`   ------------------------------------------------------------------`);

  history.forEach((snap, idx) => {
    const num = `${idx + 1}`.padEnd(4);
    const dateStr = new Date(snap.timestamp).toLocaleString().slice(0, 20).padEnd(22);
    const scoreStr = `${snap.health.score}/100`.padEnd(12);
    const gradeColor = snap.health.score >= 90 ? GREEN : snap.health.score >= 70 ? YELLOW : RED;
    const gradeStr = `${gradeColor}${snap.health.grade.padEnd(10)}${RESET}`;
    const monoStr = `${snap.monoliths.total} files`.padEnd(12);
    const hazStr = `${snap.violations.total} (Crit: ${snap.violations.critical})`;
    lines.push(`   ${num} ${dateStr} ${scoreStr} ${gradeStr} ${monoStr} ${hazStr}`);
  });

  lines.push(`   ------------------------------------------------------------------`);
  lines.push('');
  return lines.join('\n');
};
