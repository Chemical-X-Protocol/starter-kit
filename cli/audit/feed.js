// Audit feed: flat, dashboard-ready rows built from .chemx/history.json and .chemx/status.json.
// The builders are pure (they take parsed data); readAuditFeed reads the files. Nothing here
// runs an audit. Every row carries ruleset/scoreModel so consumers can flag scores that a
// rules change makes incomparable.
import { getAuditHistory } from './history.js';
import { readAuditStatus } from './status-file.js';

export const FEED_VIEWS = ['history', 'pillars', 'scopes'];

const orNull = (value) => value ?? null;

const isInScope = (rowScope, scope) => {
  const hasScopeFilter = typeof scope === 'string' && scope.length > 0;
  if (!hasScopeFilter) return true;
  const isExact = rowScope === scope;
  const isNested = typeof rowScope === 'string' && rowScope.startsWith(`${scope}/`);
  return isExact || isNested;
};

const isSince = (timestamp, since) => {
  const hasSince = Boolean(since);
  if (!hasSince) return true;
  return new Date(timestamp).getTime() >= new Date(since).getTime();
};

const matchesFilters = (snapshot, { scope, since, fullOnly = false } = {}) => {
  const isPartialExcluded = fullOnly && Boolean(snapshot.isPartial);
  if (isPartialExcluded) return false;
  return isInScope(orNull(snapshot.scope), scope) && isSince(snapshot.timestamp, since);
};

const runIdentity = (snapshot) => ({
  runId: orNull(snapshot.id),
  timestamp: orNull(snapshot.timestamp),
  scope: orNull(snapshot.scope),
  isPartial: Boolean(snapshot.isPartial),
  ruleset: orNull(snapshot.ruleset)
});

const toHistoryRow = (snapshot) => {
  const { health = {}, aiSlop = {}, metrics = {}, violations = {}, monoliths = {} } = snapshot;
  return {
    ...runIdentity(snapshot),
    scoreModel: orNull(snapshot.scoreModel),
    healthScore: orNull(health.score),
    grade: orNull(health.grade),
    aiSlopScore: orNull(aiSlop.score),
    aiSlopGrade: orNull(aiSlop.grade),
    files: orNull(metrics.scannedFiles),
    loc: orNull(metrics.totalLoc),
    violations: orNull(violations.total),
    critical: orNull(violations.critical),
    high: orNull(violations.high),
    medium: orNull(violations.medium),
    low: orNull(violations.low),
    monoliths: orNull(monoliths.total)
  };
};

export const historyRows = (history = [], filters = {}) =>
  history.filter((snapshot) => matchesFilters(snapshot, filters)).map(toHistoryRow);

export const pillarRows = (history = [], filters = {}) =>
  history
    .filter((snapshot) => matchesFilters(snapshot, filters))
    .flatMap((snapshot) => Object.entries(snapshot.pillars ?? {}).map(([pillar, data]) => ({
      ...runIdentity(snapshot),
      pillar,
      status: orNull(data.status),
      violations: orNull(data.violations),
      critical: orNull(data.critical)
    })));

const newestFullRunByScope = (history) => {
  const byScope = new Map();
  for (const snapshot of history) {
    const hasScope = typeof snapshot.scope === 'string';
    const isFullRun = hasScope && !snapshot.isPartial;
    if (isFullRun) byScope.set(snapshot.scope, snapshot);
  }
  return byScope;
};

const countRunsByScope = (history) => {
  const counts = new Map();
  for (const snapshot of history) counts.set(snapshot.scope, (counts.get(snapshot.scope) ?? 0) + 1);
  return counts;
};

const toScopeRow = (scope, run, entry, runCount) => {
  const runRow = run ? toHistoryRow(run) : null;
  const gate = entry?.gate ?? {};
  return {
    scope,
    runs: runCount,
    runId: orNull(runRow?.runId),
    lastFullRunAt: orNull(runRow?.timestamp),
    ruleset: orNull(runRow?.ruleset ?? entry?.ruleset),
    scoreModel: orNull(runRow?.scoreModel ?? entry?.scoreModel),
    healthScore: orNull(runRow?.healthScore ?? entry?.health?.score),
    grade: orNull(runRow?.grade ?? entry?.health?.grade),
    aiSlopScore: orNull(runRow?.aiSlopScore),
    files: orNull(runRow?.files),
    loc: orNull(runRow?.loc),
    violations: orNull(runRow?.violations),
    critical: orNull(runRow?.critical ?? entry?.hazards?.critical),
    high: orNull(runRow?.high ?? entry?.hazards?.high),
    medium: orNull(runRow?.medium ?? entry?.hazards?.medium),
    low: orNull(runRow?.low ?? entry?.hazards?.low),
    monoliths: orNull(runRow?.monoliths),
    gatePassing: orNull(gate.isPassing),
    gateBasis: orNull(gate.basis),
    gateRegressions: orNull(gate.regressions),
    coverageAstPct: orNull(entry?.coverage?.astPct),
    statusUpdatedAt: orNull(entry?.updatedAt),
    statusIsPartial: Boolean(entry?.isPartialScan)
  };
};

export const scopeRows = (history = [], status = null, filters = {}) => {
  const statusScopes = status?.scopes ?? {};
  const fullRuns = newestFullRunByScope(history);
  const runCounts = countRunsByScope(history);
  const scopes = new Set([...fullRuns.keys(), ...Object.keys(statusScopes)]);
  for (const snapshot of history) {
    const hasScope = typeof snapshot.scope === 'string';
    if (hasScope) scopes.add(snapshot.scope);
  }
  return [...scopes]
    .filter((scope) => isInScope(scope, filters.scope))
    .sort()
    .map((scope) => toScopeRow(scope, fullRuns.get(scope), statusScopes[scope], runCounts.get(scope) ?? 0));
};

const VIEW_BUILDERS = {
  history: (history, _status, filters) => historyRows(history, filters),
  pillars: (history, _status, filters) => pillarRows(history, filters),
  scopes: (history, status, filters) => scopeRows(history, status, filters)
};

export const readAuditFeed = (view, { cwd = process.cwd(), ...filters } = {}) => {
  const build = VIEW_BUILDERS[view];
  const isKnownView = typeof build === 'function';
  if (!isKnownView) throw new Error(`Unknown audit feed view "${view}". Use one of: ${FEED_VIEWS.join(', ')}.`);
  return build(getAuditHistory(cwd), readAuditStatus(cwd), filters);
};
