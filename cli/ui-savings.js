/**
 * GET /api/savings: token savings measured from the tool_calls ledger on this board, for the savings certificate (#7641).
 * Uses the same accounting as `chemx report savings` (cli/telemetry/savings-tooling.js): only calls that recorded a
 * native counterfactual count as savings; the net subtracts what every other logged call returned. Tokens are
 * characters / 4, an estimate. Nothing is extrapolated, and no dollar figure is claimed.
 */
import { accountCalls } from './telemetry/savings-tooling.js';

const hasLedger = (db) => Boolean(db?.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tool_calls'").get());

export const readBoardSavings = (db) => {
  if (!hasLedger(db)) return { success: true, hasData: false };
  const rows = db.prepare('SELECT action, result_chars, cf_kind, cf_chars, cf_calls FROM tool_calls').all();
  const range = db.prepare('SELECT MIN(ts) AS since, MAX(ts) AS until FROM tool_calls').get() || {};
  const { actions, totals } = accountCalls(rows);
  const measuredActions = actions.filter((a) => a.measured > 0).sort((a, b) => b.savedTokens - a.savedTokens);
  const returnedMeasured = measuredActions.reduce((n, a) => n + a.measuredResultTokens, 0);
  const counterfactual = measuredActions.reduce((n, a) => n + a.counterfactualTokens, 0);
  return {
    success: true, hasData: rows.length > 0, since: range.since ?? null, until: range.until ?? null,
    totals: { ...totals, measuredReturnedTokens: returnedMeasured, counterfactualTokens: counterfactual },
    topActions: measuredActions.slice(0, 6).map(({ action, measured, measuredResultTokens, counterfactualTokens, savedTokens }) => ({ action, measured, measuredResultTokens, counterfactualTokens, savedTokens }))
  };
};
