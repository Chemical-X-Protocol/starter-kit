// MCP action audit_feed: read-only audit feed rows (cli/audit/feed.js). Never runs an audit.
// Accepts params ({ view, scope, since, fullOnly, limit }) or the CLI string form's args
// (`audit --feed=scopes --scope=apps`). Returns the newest rows, capped to keep MCP replies
// small, with total and cut so a caller knows when to narrow by scope or since.
import { readAuditFeed } from '../audit/feed.js';
import { parseFeedArgs } from '../commands/cmd-audit-feed.js';

export const FEED_DEFAULT_LIMIT = 100;
export const FEED_MAX_LIMIT = 500;

const clampLimit = (requested) => {
  const isUsable = Number.isInteger(requested) && requested > 0;
  return isUsable ? Math.min(requested, FEED_MAX_LIMIT) : FEED_DEFAULT_LIMIT;
};

const resolveFeedParams = (params) => {
  const hasArgs = Array.isArray(params.args);
  const fromArgs = hasArgs ? parseFeedArgs(params.args) : {};
  return {
    view: params.view ?? fromArgs.view ?? 'history',
    scope: params.scope ?? fromArgs.scope,
    since: params.since ?? fromArgs.since,
    fullOnly: Boolean(params.fullOnly ?? fromArgs.fullOnly),
    limit: clampLimit(params.limit ?? fromArgs.limit)
  };
};

export const handleChemxAuditFeed = (params = {}, cwd = process.cwd()) => {
  const { view, scope, since, fullOnly, limit } = resolveFeedParams(params);
  const rows = readAuditFeed(view, { cwd, scope, since, fullOnly });
  const shown = rows.slice(-limit);
  return { view, total: rows.length, returned: shown.length, cut: rows.length > shown.length, rows: shown };
};
