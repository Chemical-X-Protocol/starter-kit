// Heavy chemx jobs (a full test suite, a typecheck, a build) from every session on the machine take
// turns in one first-come line and share one run between callers who asked for the same thing (job
// line spec 2026-10-13, sections 1-2). A heavy request takes a ticket, or joins a waiting ticket
// with the same key. The ticket first in line starts once nothing else runs and its heavy slots
// (0..heavy-1) are free, and holds them while it runs, so light test runs keep the reserve slots
// beside it (test-slots.js). Every read-then-write of the line's files runs inside withMutex; the
// job itself runs outside it. The turns live in job-line-turns.js, the files in job-line-tickets.js.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SLOT_OWNER_ENV, SLOT_DEFAULTS, defaultSlotsDir, resolveTestBudget, withMutex, readHolder, identityOf, delay, everyBeat } from './slot-files.js';
import { resolveLanes, writeTicket, readTicket, writeJoin, liveJoins, leaveJoin, writeResult, clearTicket } from './job-line-tickets.js';
import { enterLine, recordOf, TURNS } from './job-line-turns.js';
import { ownerOf, waitLine } from './job-line-text.js';

export { resolveLanes } from './job-line-tickets.js';
export const HEAVY_KINDS = ['tests', 'typecheck', 'build'];
const RETRY_BY_KIND = { tests: 'chemx test', typecheck: 'chemx typecheck', build: 'chemx build' };

export const jobKey = ({ kind, cwd, command }) => `${kind}:${path.resolve(cwd)}:${command}`;

const createJob = (kind, key, options, env, budget) => {
  const isHeavyKind = HEAVY_KINDS.includes(kind);
  if (!isHeavyKind) throw new Error(`chemx: unknown heavy job kind "${kind}" (expected ${HEAVY_KINDS.join(', ')})`);
  const dir = options.dir || defaultSlotsDir(env);
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir, kind, key, budget, heavy: resolveLanes(env, budget).heavy, token: randomUUID(), identity: identityOf(options, env),
    pollMs: options.pollMs ?? SLOT_DEFAULTS.pollMs, heartbeatMs: options.heartbeatMs ?? SLOT_DEFAULTS.heartbeatMs,
    staleMs: options.staleMs ?? SLOT_DEFAULTS.staleMs, statusMs: options.statusMs ?? SLOT_DEFAULTS.statusMs,
    onWait: options.onWait || ((line) => process.stderr.write(line)), signal: options.signal,
    returnQueuedAfterMs: options.returnQueuedAfterMs, retryCommand: options.retryCommand || RETRY_BY_KIND[kind],
    start: Date.now(), since: Date.now(), lastStatus: null, role: 'none', seq: 0, slotFiles: []
  };
};

const queuedOutcome = (job, view, queuedMs) => {
  const ahead = view.ahead.map((entry) => ({ seq: entry.seq, kind: entry.kind, state: entry.state, handle: entry.handle ?? null, task: entry.task ?? null }));
  return { queued: true, position: view.position, ahead, retryCommand: job.retryCommand, workers: 0, budget: job.budget, queuedMs };
};

// Rule 5: the wait line once, then every statusMs.
const reportWait = (job, view) => {
  const now = Date.now();
  const isStatusDue = job.lastStatus === null || now - job.lastStatus >= job.statusMs;
  if (isStatusDue) {
    job.onWait(waitLine(view, now));
    job.lastStatus = now;
  }
};

// Polls until the owner may start ({ isFinal }), a joiner has its result or a caller gives up
// waiting ({ isFinal, value }). Heavy tickets have no wait timeout: a dead holder goes by heartbeat.
const waitTurn = async (job) => {
  for (;;) {
    const isAborted = Boolean(job.signal?.aborted);
    if (isAborted) throw new Error('chemx: cancelled while waiting in line');
    const step = TURNS[job.role](job);
    if (step.isFinal) return step;
    reportWait(job, step.view);
    const waitedMs = Date.now() - job.start;
    const shouldReturnQueued = job.returnQueuedAfterMs !== undefined && waitedMs >= job.returnQueuedAfterMs;
    if (shouldReturnQueued) return { isFinal: true, value: queuedOutcome(job, step.view, waitedMs) };
    await delay(job.pollMs);
  }
};

const releaseTicket = (job, now) => {
  for (const file of job.slotFiles) {
    const isOurSlot = readHolder(file)?.token === job.token;
    if (isOurSlot) fs.rmSync(file, { force: true });
  }
  job.slotFiles = [];
  const isOurTicket = readTicket(job.dir, job.seq)?.token === job.token;
  if (isOurTicket) clearTicket(job.dir, job.seq, now, job.staleMs);
};

// Gives back whatever the job still holds; the token checks leave a takeover's files alone.
const leaveLine = (job) => {
  const isHolding = job.role !== 'done';
  if (isHolding) withMutex(job.dir, () => {
    const now = Date.now();
    const isJoiner = job.role === 'joiner';
    if (isJoiner) leaveJoin(job.dir, job.seq, recordOf(job, now), now, job.staleMs);
    else releaseTicket(job, now);
    job.role = 'done';
  });
};

// Rule 3: write the result for live joiners, then free the slots and the ticket, in one section,
// so a joiner never sees the ticket gone without its result.
const finishTicket = (job, result) => withMutex(job.dir, () => {
  const now = Date.now();
  const joined = liveJoins(job.dir, job.seq, now, job.staleMs).length;
  const hasJoiners = joined > 0;
  if (hasJoiners) writeResult(job.dir, job.seq, { owner: ownerOf({ ...job.identity, pid: process.pid }), joined, workers: job.heavy, result });
  releaseTicket(job, now);
  job.role = 'done';
  return joined;
});

const refreshTicket = (job, now) => {
  const ticket = readTicket(job.dir, job.seq);
  const isOurTicket = ticket?.token === job.token;
  if (isOurTicket) writeTicket(job.dir, job.seq, { ...ticket, heartbeat: now });
  for (const file of job.slotFiles) {
    const record = readHolder(file);
    const isOurSlot = record?.token === job.token;
    if (isOurSlot) fs.writeFileSync(file, JSON.stringify({ ...record, heartbeat: now }));
  }
};

// A joiner rewrites its whole join file, so one swept while its process lived comes back.
const refreshHeld = (job, now) => {
  const isJoiner = job.role === 'joiner';
  if (isJoiner) writeJoin(job.dir, job.seq, recordOf(job, now));
  const isOwner = job.role === 'owner';
  if (isOwner) refreshTicket(job, now);
};

// Heartbeats every held file (ticket or join, and the slots while running) inside the mutex, and
// gives them back if the process exits while it holds them.
const keepAlive = (job) => {
  const stopBeat = everyBeat(job.heartbeatMs, () => withMutex(job.dir, () => refreshHeld(job, Date.now())));
  const onExit = () => leaveLine(job);
  process.once('exit', onExit);
  return () => {
    stopBeat();
    process.removeListener('exit', onExit);
  };
};

const runAsOwner = async (job, run) => {
  const queuedMs = Date.now() - job.start;
  const result = await run(job.heavy);
  const joined = finishTicket(job, result);
  const hasJoiners = joined > 0;
  const shared = hasJoiners ? { owner: ownerOf({ ...job.identity, pid: process.pid }), joined, seq: job.seq } : null;
  return { result, workers: job.heavy, budget: job.budget, queuedMs, shared };
};

/**
 * Runs `run(workers)` as a heavy job: waits its turn in the line, or joins a waiting ticket with the same key.
 * Resolves to { result, workers, budget, queuedMs, shared } where `shared` is null for the owner of an unshared
 * run, else { owner, joined, seq }; or, after options.returnQueuedAfterMs, to
 * { queued: true, position, ahead, retryCommand, workers: 0, budget, queuedMs } with nothing held.
 * `run`'s result must be JSON-serialisable (executeBuild's is). A run that throws writes no result:
 * its joiners take the ticket over in turn. Options: dir, env, budget, handle, task, command, onWait,
 * signal, returnQueuedAfterMs, retryCommand, pollMs, heartbeatMs, staleMs, statusMs.
 */
export const runHeavy = async ({ kind, key, ...options }, run) => {
  const env = options.env || process.env;
  const budget = options.budget ?? resolveTestBudget(env);
  // Rule 6: a chemx run inside a heavy run is covered by its parent's slots; it must not wait on it.
  const isNested = Boolean(env[SLOT_OWNER_ENV]);
  if (isNested) return { result: await run(1), workers: 1, budget, queuedMs: 0, shared: null, nested: true };
  const job = createJob(kind, key, options, env, budget);
  enterLine(job);
  const stopKeepingAlive = keepAlive(job);
  try {
    const step = await waitTurn(job);
    const hasOutcome = Boolean(step.value);
    if (hasOutcome) return step.value;
    return await runAsOwner(job, run);
  } finally {
    stopKeepingAlive();
    leaveLine(job);
  }
};
