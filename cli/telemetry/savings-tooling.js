/**
 * Chemical X Protocol: the tooling line of `chemx report savings` (#2498).
 * Compares what chemx returned with what chemx itself recorded as the native counterfactual (see
 * call-schema.js for the kinds). Only calls that carry a counterfactual contribute savings; nothing is
 * extrapolated to calls that do not. Net savings subtract the tokens returned by every call WITHOUT a
 * counterfactual, because those tokens cost the agent context and have nothing to offset them.
 * All token figures are characters / 4, an estimate.
 */
import { initCallSchema } from './call-schema.js';
import { estimateTokens } from './call-ledger.js';

/** Below this many measured calls an action's line is shown but flagged as too little data. */
export const MIN_MEASURED_CALLS = 5;

export const KIND_METHODS = {
  'file-whole': 'result vs the whole file a native whole-file Read would return (characters, tokens = chars/4). Assumes the agent would otherwise read whole files.',
  'raw-output': 'summary vs the raw stdout+stderr chemx captured from the tool. Assumes the agent would otherwise see the raw output (it may filter it).',
  'validation-call': 'separate check calls avoided because the patch result already carries validation. Counted in calls; no token saving is claimed.'
};

const CHAR_KINDS = new Set(['file-whole', 'raw-output']);

const emptyAction = (action) => ({
  action, calls: 0, resultChars: 0, measured: 0, measuredResultChars: 0, counterfactualChars: 0, callsAvoided: 0, validated: 0, kinds: new Set()
});

const addRow = (entry, row) => {
  const isChar = CHAR_KINDS.has(row.cf_kind);
  const isValidation = row.cf_kind === 'validation-call';
  entry.calls += 1;
  entry.resultChars += row.result_chars;
  if (isChar) {
    entry.measured += 1;
    entry.measuredResultChars += row.result_chars;
    entry.counterfactualChars += row.cf_chars;
  }
  if (isValidation) {
    entry.validated += 1;
    entry.callsAvoided += row.cf_calls;
  }
  const hasKind = Boolean(row.cf_kind);
  if (hasKind) entry.kinds.add(row.cf_kind);
};

const finishAction = (entry) => {
  const savedChars = entry.counterfactualChars - entry.measuredResultChars;
  const isThin = entry.measured < MIN_MEASURED_CALLS && entry.validated < MIN_MEASURED_CALLS;
  return {
    action: entry.action,
    calls: entry.calls,
    measured: entry.measured,
    resultTokens: estimateTokens(entry.resultChars),
    measuredResultTokens: estimateTokens(entry.measuredResultChars),
    counterfactualTokens: estimateTokens(entry.counterfactualChars),
    savedTokens: estimateTokens(entry.counterfactualChars) - estimateTokens(entry.measuredResultChars),
    savedChars,
    callsAvoided: entry.callsAvoided,
    validated: entry.validated,
    kinds: [...entry.kinds],
    isThin
  };
};

/**
 * Pure accounting over tool_calls rows ({ action, result_chars, cf_kind, cf_chars, cf_calls }).
 * Returns per-action lines and totals including the overhead and the net figure.
 */
export const accountCalls = (rows) => {
  const byAction = new Map();
  for (const row of rows) {
    const entry = byAction.get(row.action) || emptyAction(row.action);
    addRow(entry, row);
    byAction.set(row.action, entry);
  }
  const actions = [...byAction.values()].map(finishAction).sort((a, b) => b.calls - a.calls);
  const resultChars = rows.reduce((n, r) => n + r.result_chars, 0);
  const measuredRows = rows.filter((r) => CHAR_KINDS.has(r.cf_kind));
  const measuredResultChars = measuredRows.reduce((n, r) => n + r.result_chars, 0);
  const counterfactualChars = measuredRows.reduce((n, r) => n + r.cf_chars, 0);
  const unmeasuredResultChars = resultChars - measuredResultChars;
  const grossSavedTokens = estimateTokens(counterfactualChars) - estimateTokens(measuredResultChars);
  const overheadTokens = estimateTokens(resultChars);
  const unmeasuredTokens = estimateTokens(unmeasuredResultChars);
  return {
    actions,
    totals: {
      calls: rows.length,
      measured: measuredRows.length,
      overheadTokens,
      grossSavedTokens,
      unmeasuredTokens,
      netSavedTokens: grossSavedTokens - unmeasuredTokens,
      callsAvoided: rows.reduce((n, r) => n + (r.cf_kind === 'validation-call' ? r.cf_calls : 0), 0)
    }
  };
};

/** Merge a handle's agent windows so a call is never counted twice. */
export const mergeWindows = (windows) => {
  const sorted = windows.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end)).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    const isOverlap = Boolean(last) && w.start <= last.end;
    if (isOverlap) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }
  return merged;
};

/** The per-handle time windows of a priced run: where each handle was working. */
export const handleWindows = (pricedRows) => {
  const byHandle = new Map();
  for (const r of pricedRows) {
    const list = byHandle.get(r.handle) || [];
    list.push({ start: r.startedAt, end: r.endedAt });
    byHandle.set(r.handle, list);
  }
  byHandle.delete(null);
  byHandle.delete(undefined);
  return new Map([...byHandle].map(([handle, list]) => [handle, mergeWindows(list)]));
};

const WINDOW_SQL = `SELECT action, result_chars, cf_kind, cf_chars, cf_calls FROM tool_calls WHERE agent = ? AND ts >= ? AND ts <= ?`;

/**
 * Calls recorded for the handles of a run, inside those handles' own working windows. Calls with no
 * handle are not attributable and are counted separately, never added to the savings.
 */
export const loadRunCalls = (db, windows, runWindow) => {
  initCallSchema(db);
  const rows = [];
  const select = db.prepare(WINDOW_SQL);
  for (const [handle, list] of windows) {
    for (const w of list) rows.push(...select.all(handle, w.start, w.end));
  }
  const unattributed = db.prepare('SELECT COUNT(*) AS n FROM tool_calls WHERE agent IS NULL AND ts >= ? AND ts <= ?').get(runWindow.start, runWindow.end);
  const logged = db.prepare('SELECT MIN(ts) AS firstAt, COUNT(*) AS total FROM tool_calls').get();
  return { rows, unattributed: unattributed.n, loggedFrom: logged.firstAt, loggedTotal: logged.total };
};
