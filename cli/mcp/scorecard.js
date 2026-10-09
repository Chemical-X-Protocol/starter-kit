// chemx://scorecard: the AST audit runs in a worker thread with a timeout,
// so a long audit never blocks ping, cancellation or other requests on the server.
import fs from 'node:fs';
import path from 'node:path';
import { runWorker } from './worker-run.js';

const DEFAULT_SCORECARD_TIMEOUT_MS = 120000;
const WORKER_URL = new URL('./scorecard-worker.js', import.meta.url);

const countSeverities = (violations = []) => violations.reduce((rollup, v) => {
  const isTracked = Object.hasOwn(rollup, v.severity);
  if (isTracked) rollup[v.severity] += 1;
  return rollup;
}, { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 });

const hasMolecules = (report) => (report.metrics?.moleculeCount ?? 0) > 0 && typeof report.metrics.moleculeCompliantPct === 'number';

export const buildScorecard = (report) => ({
  grade: report.health?.grade || 'N/A',
  score: report.health?.score ?? 100,
  status: report.health?.isPassing ? 'PASS' : 'FAIL',
  scannedFiles: report.metrics?.scannedFiles || 0,
  totalLoc: report.metrics?.totalLoc || 0,
  // No molecules means nothing to be compliant with: null, never a free 100.
  moleculeCount: report.metrics?.moleculeCount ?? 0,
  moleculeCompliantPct: hasMolecules(report) ? report.metrics.moleculeCompliantPct : null,
  severityRollup: countSeverities(report.violations),
  totalViolations: report.totalViolations || 0,
  topHotspots: (report.hotspots || []).slice(0, 3).map((h) => ({ file: h.filePath, lines: h.lineCount, violations: h.violationCount ?? 0 })),
  patternCandidatesCount: (report.patterns || []).length
});

export const scorecardTarget = (cwd) => {
  const srcDir = path.resolve(cwd, 'src');
  return fs.existsSync(srcDir) ? srcDir : path.resolve(cwd);
};

export const computeScorecard = (cwd, { timeoutMs = DEFAULT_SCORECARD_TIMEOUT_MS } = {}) => runWorker(
  WORKER_URL,
  { cwd, targetDir: scorecardTarget(cwd) },
  { label: 'scorecard audit', timeoutMs }
);
