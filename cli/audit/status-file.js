/**
 * `.chemx/status.json`: the latest audit verdict per scope, for hooks, statuslines
 * and agents that need the gate state without re-running the audit.
 *   { version: 1, latestScope, scopes: { <scope>: { updatedAt, ruleset, scoreModel, health, gate, coverage, hazards } } }
 * It lives in the same .chemx/ as audit history (findChemxDir), which ensureChemxDir
 * gitignores, so an audit never leaves an untracked .chemx/ in the audited project.
 */
import fs from 'node:fs';
import path from 'node:path';
import { findChemxDir, ensureChemxDir } from './history.js';

export const STATUS_FILE = path.join('.chemx', 'status.json');
const STATUS_BASENAME = 'status.json';
const STATUS_VERSION = 1;

const countBySeverity = (violations = []) => {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const v of violations) {
    const key = String(v.severity || 'LOW').toLowerCase();
    const isKnownSeverity = key in counts;
    if (isKnownSeverity) counts[key] += 1;
  }
  return counts;
};

export const readAuditStatus = (projectRoot) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(findChemxDir(projectRoot), STATUS_BASENAME), 'utf-8'));
    const hasScopes = parsed !== null && typeof parsed === 'object' && typeof parsed.scopes === 'object';
    return hasScopes ? parsed : null;
  } catch {
    return null;
  }
};

export const buildScopeStatus = (report) => ({
  updatedAt: new Date().toISOString(),
  ruleset: report.ruleset ?? null,
  scoreModel: report.scoreModel ?? null,
  health: { score: report.health?.score ?? null, grade: report.health?.grade ?? null, density: report.health?.density ?? null },
  gate: {
    isPassing: report.gate?.isPassing ?? null,
    basis: report.gate?.basis ?? null,
    regressions: (report.gate?.regressions ?? []).length,
    adopted: (report.gate?.adopted ?? []).map((a) => a.rule)
  },
  coverage: report.coverage ? { astPct: report.coverage.astPct, isPartial: report.coverage.isPartial } : null,
  hazards: countBySeverity(report.violations),
  isPartialScan: Boolean(report.options?.fileList) || Boolean(report.options?.fast)
});

/** Merges one scope's status into .chemx/status.json; returns the written payload or null. */
export const writeAuditStatus = (projectRoot, { scope, report }) => {
  const existing = readAuditStatus(projectRoot) ?? { scopes: {} };
  const payload = {
    version: STATUS_VERSION,
    latestScope: scope,
    scopes: { ...existing.scopes, [scope]: buildScopeStatus(report) }
  };
  try {
    const chemxDir = ensureChemxDir(projectRoot);
    fs.writeFileSync(path.join(chemxDir, STATUS_BASENAME), JSON.stringify(payload, null, 2) + '\n', 'utf-8');
    return payload;
  } catch {
    return null;
  }
};
