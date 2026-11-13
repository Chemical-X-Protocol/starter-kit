/**
 * The async check queue (`chemx team check <kind>`): enqueue and return at once. Identical queued
 * jobs coalesce (the later caller joins as a requester), a running job at the same tree joins too,
 * and a green result at the same tree fingerprint within the TTL answers from cache. Nothing here
 * runs a check: the drain worker (check-drainer.js) does, one job at a time.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { withImmediateTransaction } from './team-db-transaction.js';

export const CHECK_KINDS = Object.freeze(['typecheck', 'test', 'verify', 'build']);
export const CACHE_TTL_MS = 600_000;
const DEFAULT_PRIORITY = 2;

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });

const statStamp = (cwd, relPath) => {
  try {
    const { size, mtimeMs } = statSync(join(cwd, relPath));
    return `${relPath}:${size}:${Math.floor(mtimeMs)}`;
  } catch {
    return `${relPath}:gone`;
  }
};

/** A hash of the working tree's state: HEAD plus every changed or untracked path with its size and mtime. '' when git cannot say. */
export const treeFingerprint = (cwd) => {
  try {
    const head = git(cwd, ['rev-parse', 'HEAD']).trim();
    const changed = git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter(Boolean).map((entry) => entry.slice(3));
    const stamps = changed.sort().map((relPath) => statStamp(cwd, relPath));
    return createHash('sha1').update([head, ...stamps].join('\n')).digest('hex').slice(0, 16);
  } catch {
    return '';
  }
};

const parseResult = (text) => {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
};

export const rowToJob = (row) => (row ? { ...row, result: parseResult(row.result) } : null);

const addRequester = (db, jobId, agentId, taskId) => {
  db.prepare('INSERT OR IGNORE INTO check_requesters (job_id, agent_id, task_id) VALUES (?, ?, ?)').run(jobId, agentId, taskId || null);
};

const queuePosition = (db, jobId) => {
  const ahead = db.prepare("SELECT COUNT(*) AS n FROM check_jobs WHERE id < ? AND status IN ('queued', 'running')").get(jobId);
  return ahead.n + 1;
};

const findCachedGreen = (db, key, fingerprint, now, ttlMs) => {
  const row = db.prepare("SELECT * FROM check_jobs WHERE kind = ? AND cwd = ? AND command = ? AND tree_fp = ? AND status = 'done' AND finished_at >= ? ORDER BY id DESC LIMIT 1").get(key.kind, key.cwd, key.command, fingerprint, now - ttlMs);
  const job = rowToJob(row);
  const isFreshGreen = Boolean(job) && job.result.status === 'pass' && job.result.stale !== true;
  return isFreshGreen ? job : null;
};

/**
 * Enqueues one check inside a single immediate transaction and returns
 * { action: 'queued' | 'coalesced' | 'joined' | 'cached', id, position, job }.
 */
export const enqueueCheck = (db, { kind, cwd, requester, taskId = null, fingerprint = '', now = Date.now(), ttlMs = CACHE_TTL_MS, command = kind }) => {
  const key = { kind, cwd, command };
  return withImmediateTransaction(db, () => {
    const queued = db.prepare("SELECT * FROM check_jobs WHERE kind = ? AND cwd = ? AND command = ? AND status = 'queued' ORDER BY id LIMIT 1").get(kind, cwd, command);
    if (queued) {
      addRequester(db, queued.id, requester, taskId);
      return { action: 'coalesced', id: queued.id, position: queuePosition(db, queued.id), job: rowToJob(queued) };
    }
    const running = db.prepare("SELECT * FROM check_jobs WHERE kind = ? AND cwd = ? AND command = ? AND status = 'running' AND tree_fp = ? ORDER BY id LIMIT 1").get(kind, cwd, command, fingerprint);
    const canJoin = Boolean(running) && fingerprint !== '';
    if (canJoin) {
      addRequester(db, running.id, requester, taskId);
      return { action: 'joined', id: running.id, position: 1, job: rowToJob(running) };
    }
    const cached = fingerprint ? findCachedGreen(db, key, fingerprint, now, ttlMs) : null;
    if (cached) return { action: 'cached', id: cached.id, position: 0, job: cached };
    const info = db.prepare('INSERT INTO check_jobs (kind, cwd, command, tree_fp, run_at, priority, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(kind, cwd, command, fingerprint, now, DEFAULT_PRIORITY, requester, now);
    const id = Number(info.lastInsertRowid);
    addRequester(db, id, requester, taskId);
    return { action: 'queued', id, position: queuePosition(db, id), job: rowToJob(db.prepare('SELECT * FROM check_jobs WHERE id = ?').get(id)) };
  });
};

export const getCheck = (db, id) => {
  const job = rowToJob(db.prepare('SELECT * FROM check_jobs WHERE id = ?').get(id));
  if (!job) return null;
  const requesters = db.prepare('SELECT agent_id, task_id, notified_at FROM check_requesters WHERE job_id = ? ORDER BY agent_id').all(id);
  return { ...job, requesters };
};

export const listChecks = (db, { limit = 20, status = null } = {}) => {
  const rows = status
    ? db.prepare('SELECT * FROM check_jobs WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit)
    : db.prepare('SELECT * FROM check_jobs ORDER BY id DESC LIMIT ?').all(limit);
  return rows.map(rowToJob);
};

/** Cancels a queued or running job; a running job's result is discarded when its worker finishes. */
export const cancelCheck = (db, id, now = Date.now()) => withImmediateTransaction(db, () => {
  const job = db.prepare('SELECT id, status FROM check_jobs WHERE id = ?').get(id);
  if (!job) return { ok: false, reason: `No check #${id}.` };
  const isOpen = job.status === 'queued' || job.status === 'running';
  if (!isOpen) return { ok: false, reason: `Check #${id} is already ${job.status}.` };
  db.prepare("UPDATE check_jobs SET status = 'cancelled', finished_at = ? WHERE id = ?").run(now, id);
  return { ok: true, wasRunning: job.status === 'running' };
});

export const countByStatus = (db) => {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM check_jobs GROUP BY status').all();
  return Object.fromEntries(rows.map((row) => [row.status, row.n]));
};
