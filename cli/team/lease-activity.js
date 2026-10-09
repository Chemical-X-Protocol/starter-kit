/**
 * Chemical X Protocol: any chemx activity by a lease holder keeps that holder's leases alive.
 *
 * Without this a lease only lived while its holder edited the locked file, so a long test run, a
 * read-heavy stage, or a lock taken early and edited late let it lapse (Forge run wf_bff995e7-099).
 *
 * - renewHolderLeases: one UPDATE per lock db that the holder has a live lease in. It runs at the
 *   one place CLI commands pass (cli/main.js) and the one place MCP calls pass (executeMcpTool).
 * - startLeaseKeepalive: for commands longer than a lease TTL (test, verify, typecheck, build,
 *   audit), renews every TTL/2 while the command runs. The timer is unref'd, so it never keeps a
 *   process alive.
 * Guarantees and limits: only the identity's own LIVE leases are extended, never an expired one
 * (a lapse stays visible), never another handle's. The keepalive runs on the event loop, so a command
 * that blocks the loop for longer than the TTL (a synchronous child process) is not covered. Every
 * failure is swallowed (fail open): a renewal problem never fails the command.
 */
import { ancestorLockRoots } from './lease-roots.js';
import { openTeamDbReadOnly, openExistingTeamDb, closeQuietly, safeGet } from './team-db-readonly.js';
import { DEFAULT_TTL_MS } from './team-db-lock-promotion.js';
import { resolveAgentIdentity } from './agent-identity.js';

// Commands that can outlast a lease TTL, with their CLI aliases.
export const LONG_RUNNING_COMMANDS = new Set([
  'test', 'tests', 'check:test', 'lint', 'check:lint', 'eslint',
  'verify', 'check:all', 'typecheck', 'check:types', 'tsc', 'build', 'run', 'wrap', 'audit'
]);

/** The explicit handle in CLI args: --as=@x or --as @x. */
export const agentFromArgs = (args = []) => {
  const inline = args.find((arg) => typeof arg === 'string' && arg.startsWith('--as='));
  if (inline) return inline.slice('--as='.length);
  const flagAt = args.indexOf('--as');
  const hasFlag = flagAt >= 0 && typeof args[flagAt + 1] === 'string';
  return hasFlag ? args[flagAt + 1] : undefined;
};

/** The caller's handle, or null when only a per-process anonymous id exists (it cannot hold leases across commands). */
export const activityHolder = (explicitId, env = process.env) => {
  const identity = resolveAgentIdentity(explicitId, env);
  const isAnonymous = identity.source === 'process';
  return isAnonymous ? null : identity.id;
};

const holdsLiveLease = (lockRoot, holder, now) => {
  const db = openTeamDbReadOnly(lockRoot);
  const hasDb = Boolean(db);
  if (!hasDb) return false;
  const row = safeGet(db, 'SELECT 1 AS held FROM file_leases WHERE locked_by = ? AND expires_at > ? LIMIT 1', [holder, now]);
  closeQuietly(db);
  return Boolean(row);
};

const renewInRoot = (lockRoot, holder, now, ttlMs) => {
  const isHolding = holdsLiveLease(lockRoot, holder, now);
  if (!isHolding) return 0;
  const db = openExistingTeamDb(lockRoot);
  const hasDb = Boolean(db);
  if (!hasDb) return 0;
  try {
    const sql = 'UPDATE file_leases SET expires_at = MAX(expires_at, ?) WHERE locked_by = ? AND expires_at > ?';
    return Number(db.prepare(sql).run(now + ttlMs, holder, now).changes);
  } finally {
    closeQuietly(db);
  }
};

/**
 * Extends every live lease the caller holds, in every lock db from startDir upward, to now + TTL.
 * @param {string} startDir Directory the command runs in (or the project root of an MCP call).
 * @param {string} [agentId] Explicit handle; else $CHEMX_AGENT_ID, else the session handle.
 * @param {{ now?: number, ttlMs?: number, env?: object }} [options]
 * @returns {number} Leases extended (0 when anonymous, no lock db, or on any error).
 */
export const renewHolderLeases = (startDir, agentId, options = {}) => {
  try {
    const holder = activityHolder(agentId, options.env);
    if (!holder) return 0;
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
    return ancestorLockRoots(startDir).reduce((total, lockRoot) => total + renewInRoot(lockRoot, holder, now, ttlMs), 0);
  } catch (err) {
    const isDebug = Boolean(process.env.CHEMX_DEBUG);
    if (isDebug) process.stderr.write(`[lease-activity] renewal skipped: ${err.message}\n`);
    return 0;
  }
};

const noop = () => {};

/**
 * Renews the caller's leases every TTL/2 until the returned stop function runs (or the process ends).
 * @param {{ ttlMs?: number, intervalMs?: number, now?: () => number, env?: object }} [options]
 * @returns {() => void} stop
 */
export const startLeaseKeepalive = (startDir, agentId, options = {}) => {
  const holder = activityHolder(agentId, options.env);
  if (!holder) return noop;
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  const intervalMs = options.intervalMs || Math.max(1, Math.floor(ttlMs / 2));
  const clock = options.now ?? Date.now;
  const timer = setInterval(() => renewHolderLeases(startDir, holder, { ttlMs, now: clock(), env: options.env }), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
};

/**
 * The MCP front door of trackLeaseActivity. The handle comes from params.agentId, params.as, a
 * top-level agentId or as, or a CLI-style `command` string with --as; the action from args.action,
 * else the first word of `command`, else the tool name.
 * @returns {() => void} stop
 */
export const trackMcpLeaseActivity = (toolName, args, cwd, options = {}) => {
  const params = args?.params ?? {};
  const words = typeof args?.command === 'string' ? args.command.trim().split(/\s+/) : [];
  const handle = params.agentId ?? params.as ?? args?.agentId ?? args?.as ?? agentFromArgs(words);
  const action = args?.action ?? words[0] ?? toolName;
  return trackLeaseActivity(cwd, handle, String(action), options);
};

/** One call for a command: renew now, and keep renewing while it runs when it is a long one. */
export const trackLeaseActivity = (startDir, agentId, commandName, options = {}) => {
  renewHolderLeases(startDir, agentId, options);
  const isLong = LONG_RUNNING_COMMANDS.has(commandName);
  return isLong ? startLeaseKeepalive(startDir, agentId, options) : noop;
};
