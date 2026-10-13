// Cross-process test worker budget. Every `chemx test` run (CLI, MCP, verify) takes worker slots
// from lock files under os.tmpdir()/chemx-test-slots before it starts the runner, so concurrent
// runs from several agents never exceed the machine budget in total. A slot file holds the pid
// of the run that owns it, its handle, task and command when known, its start time and a
// heartbeat refreshed while held. A slot whose pid is dead, or whose heartbeat is older than the
// stale window (for example a reused pid), is reclaimed; a file without a heartbeat (written by
// an older chemx) is judged by its pid alone. A short mkdir mutex makes the scan-and-claim atomic
// across processes. Waiting runs leave a `wait-<pid>` file so the queue can be listed; the
// position it reports is informational and does not enforce first-come order.
// This is the light lane. Heavy jobs (a full suite, a typecheck, a build) take turns in the line of
// job-line.js and hold slots 0..heavy-1 while they run. A light run takes the reserve slots
// heavy..budget-1 first and spills into the heavy slots only while no heavy ticket is live, so a
// heavy job rarely waits for single-file runs. A slot file without `seq` is a light holder (old
// chemx writes only those, lowest index first).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SLOT_OWNER_ENV, SLOT_DEFAULTS, defaultSlotsDir, resolveTestBudget, withMutex, isLive, readHolder, identityOf, slotFile, delay, everyBeat } from './slot-files.js';
import { resolveLanes, liveTickets, currentLine } from './job-line-tickets.js';
import { ticketLine } from './job-line-text.js';

// The shared helpers moved to slot-files.js; re-exported so every existing import keeps working.
export { SLOT_OWNER_ENV, defaultSlotsDir, resolveTestBudget, withMutex, isLive, readHolder } from './slot-files.js';
export const SLOT_WAIT_TIMEOUT_CODE = 'CHEMX_SLOT_WAIT_TIMEOUT';
const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60000;
const LONG_WAIT_MS = 60000;

const describeHolder = (holder) => {
  const parts = [holder.handle || `pid ${holder.pid}`];
  const hasTask = Boolean(holder.task);
  const hasStart = typeof holder.since === 'number';
  if (hasTask) parts.push(`task ${holder.task}`);
  if (hasStart) parts.push(`for ${Math.max(0, Math.round((Date.now() - holder.since) / 1000))}s`);
  return parts.join(' ');
};

const indicesFrom = (start, end) => Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset);

// Light runs look at the reserve (heavy..budget-1) first, so the heavy slots stay free for the next
// heavy job, and only then at the heavy slots 0..heavy-1.
const lightScanOrder = (budget, heavy) => [...indicesFrom(heavy, budget), ...indicesFrom(0, heavy)];

// Claims up to `want` free slots, reserve first; a heavy slot only while no heavy ticket is live.
// Returns the claimed files and the live records holding the rest.
const claimFreeSlots = (dir, { budget, heavy }, want, identity, staleMs) => withMutex(dir, () => {
  const taken = [];
  const holders = [];
  const now = Date.now();
  const token = randomUUID();
  const isLineLive = liveTickets(dir, now, staleMs).length > 0;
  for (const index of lightScanOrder(budget, heavy)) {
    const hasEnough = taken.length >= want;
    if (hasEnough) break;
    const file = slotFile(dir, index);
    const holder = readHolder(file);
    if (isLive(holder, now, staleMs)) {
      holders.push(holder);
      continue;
    }
    const isKeptForLine = isLineLive && index < heavy;
    if (isKeptForLine) continue;
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token, since: now, heartbeat: now, ...identity }));
    taken.push({ file, token });
  }
  return { taken, holders };
});

const isOurs = (file, token) => {
  const record = readHolder(file);
  return record?.pid === process.pid && record?.token === token;
};

// The heartbeat reads then writes slot files, so it runs inside the mutex like every claim.
const holdSlots = (dir, taken, budget, queuedMs, heartbeatMs) => {
  const stopBeat = everyBeat(heartbeatMs, () => withMutex(dir, () => {
    for (const { file, token } of taken) {
      const record = readHolder(file);
      const isStillOurs = record?.pid === process.pid && record?.token === token;
      if (isStillOurs) fs.writeFileSync(file, JSON.stringify({ ...record, heartbeat: Date.now() }));
    }
  }));
  const releaseSync = () => {
    stopBeat();
    for (const { file, token } of taken) {
      if (isOurs(file, token)) fs.rmSync(file, { force: true });
    }
  };
  process.once('exit', releaseSync);
  const release = () => {
    process.removeListener('exit', releaseSync);
    releaseSync();
  };
  return { workers: taken.length, budget, queuedMs, nested: false, queued: false, release };
};

const waiterFile = (dir) => path.join(dir, `wait-${process.pid}`);

const writeWaiter = (dir, record) => fs.writeFileSync(waiterFile(dir), JSON.stringify(record));

const liveWaiters = (dir, now, staleMs) => {
  const names = fs.readdirSync(dir).filter((name) => name.startsWith('wait-'));
  const records = names.map((name) => readHolder(path.join(dir, name)));
  const live = records.filter((record) => isLive(record, now, staleMs));
  return live.sort((a, b) => a.since - b.since || a.pid - b.pid);
};

// The heavy line's live tickets with how many callers joined each. Sweeping dead tickets writes,
// so it runs inside the mutex.
const listTickets = (dir, now, staleMs) => withMutex(dir, () => {
  const { tickets, joins } = currentLine(dir, now, staleMs);
  return tickets.map((ticket) => ({
    seq: ticket.seq, kind: ticket.kind, state: ticket.state, handle: ticket.handle ?? null, task: ticket.task ?? null, pid: ticket.pid,
    ageMs: now - ticket.since, joined: joins.filter((join) => join.seq === ticket.seq).length
  }));
});

// Snapshot for `chemx test --slots`: who holds each slot (heavy holders carry the ticket's seq),
// who is queued for a light slot, and the heavy line.
export const listTestSlots = (options = {}) => {
  const env = options.env || process.env;
  const dir = options.dir || defaultSlotsDir(env);
  const budget = options.budget ?? resolveTestBudget(env);
  const staleMs = options.staleMs ?? SLOT_DEFAULTS.staleMs;
  const now = options.now ?? Date.now();
  const hasDir = fs.existsSync(dir);
  if (!hasDir) return { dir, budget, holders: [], waiting: [], tickets: [] };
  const holders = [];
  for (let index = 0; index < budget; index++) {
    const record = readHolder(slotFile(dir, index));
    if (!record) continue;
    const state = isLive(record, now, staleMs) ? 'held' : 'stale';
    const isHeavyHolder = Number.isInteger(record.seq);
    const lane = isHeavyHolder ? 'heavy' : 'light';
    holders.push({ slot: index, state, lane, seq: record.seq ?? null, pid: record.pid, handle: record.handle ?? null, task: record.task ?? null, command: record.command ?? null, ageMs: now - record.since, heartbeatAgeMs: typeof record.heartbeat === 'number' ? now - record.heartbeat : null });
  }
  const waiting = liveWaiters(dir, now, staleMs).map((record, index) => ({ position: index + 1, pid: record.pid, handle: record.handle ?? null, task: record.task ?? null, waitedMs: now - record.since }));
  return { dir, budget, holders, waiting, tickets: listTickets(dir, now, staleMs) };
};

// Plain-text rendering of listTestSlots; states only what the files say.
export const formatTestSlots = (snapshot) => {
  const held = snapshot.holders.filter((holder) => holder.state === 'held').length;
  const lines = [`chemx test slots: ${held} of ${snapshot.budget} held, ${snapshot.waiting.length} queued (${snapshot.dir})`];
  for (const holder of snapshot.holders) {
    const who = holder.handle || 'unknown handle';
    const task = holder.task ? ` task ${holder.task}` : ' no task recorded';
    const beat = holder.heartbeatAgeMs === null ? 'no heartbeat' : `heartbeat ${Math.round(holder.heartbeatAgeMs / 1000)}s ago`;
    lines.push(`  slot ${holder.slot} ${holder.state}: ${who},${task}, pid ${holder.pid}, age ${Math.round(holder.ageMs / 1000)}s, ${beat}`);
  }
  for (const ticket of snapshot.tickets || []) lines.push(ticketLine(ticket));
  for (const waiter of snapshot.waiting) {
    lines.push(`  queued #${waiter.position}: ${waiter.handle || `pid ${waiter.pid}`}, waiting ${Math.round(waiter.waitedMs / 1000)}s`);
  }
  return `${lines.join('\n')}\n`;
};

// With no holder to name, the free slots are being kept for the heavy line.
const holderList = (holders) => [...new Set(holders.map(describeHolder))].join('; ') || 'the heavy line';

const waitLine = (budget, holders, position, waitedMs) => `chemx test: waiting for a test slot (budget ${budget} worker(s), queue position about ${position}, waited ${Math.round(waitedMs / 1000)}s, held by ${holderList(holders)}; set CHEMX_TEST_CONCURRENCY to change)\n`;

// Resolves to { workers, budget, queuedMs, nested, queued, release } once at least one slot is free.
// A run takes min(want, free slots) workers. While queued it reports itself through onWait once,
// then every statusMs (default 30s). Options:
//   waitTimeoutMs        give up after this long (default 10 min; 0 disables) with an error whose
//                        code is SLOT_WAIT_TIMEOUT_CODE and whose message names the holders
//   returnQueuedAfterMs  for hosts with a call timeout: after this long, resolve with
//                        { queued: true, position, holders, retryCommand, workers: 0 } instead
//                        of waiting; nothing is held and the caller must run retryCommand
//   onLongWait           called with { queuedMs, budget, holders } after a grant that waited 60s+
export const acquireTestSlots = async (options = {}) => {
  const env = options.env || process.env;
  const budget = options.budget ?? resolveTestBudget(env);
  const want = Math.max(1, Math.min(options.want ?? budget, budget));
  const isNested = Boolean(env[SLOT_OWNER_ENV]);
  if (isNested) return { workers: 1, budget, queuedMs: 0, nested: true, queued: false, release: () => {} };
  const dir = options.dir || defaultSlotsDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const lanes = resolveLanes(env, budget);
  const onWait = options.onWait || ((line) => process.stderr.write(line));
  const heartbeatMs = options.heartbeatMs ?? SLOT_DEFAULTS.heartbeatMs;
  const staleMs = options.staleMs ?? SLOT_DEFAULTS.staleMs;
  const statusMs = options.statusMs ?? SLOT_DEFAULTS.statusMs;
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const identity = identityOf(options, env);
  const start = Date.now();
  let lastStatus = null;
  let lastBeat = 0;
  let lastHolders = [];
  const clearWaiter = () => fs.rmSync(waiterFile(dir), { force: true });
  process.once('exit', clearWaiter);
  const finish = () => {
    process.removeListener('exit', clearWaiter);
    clearWaiter();
  };
  try {
    for (;;) {
      const { taken, holders } = claimFreeSlots(dir, lanes, want, identity, staleMs);
      lastHolders = holders;
      const hasTakenSlots = taken.length > 0;
      if (hasTakenSlots) {
        const queuedMs = Date.now() - start;
        const grant = holdSlots(dir, taken, budget, queuedMs, heartbeatMs);
        const isLongWait = queuedMs >= (options.longWaitMs ?? LONG_WAIT_MS) && Boolean(options.onLongWait);
        if (isLongWait) options.onLongWait({ queuedMs, budget, holders: lastHolders });
        return grant;
      }
      const now = Date.now();
      const waitedMs = now - start;
      const isBeatDue = now - lastBeat >= heartbeatMs || lastBeat === 0;
      if (isBeatDue) {
        writeWaiter(dir, { pid: process.pid, since: start, heartbeat: now, ...identity });
        lastBeat = now;
      }
      const position = liveWaiters(dir, now, staleMs).findIndex((record) => record.pid === process.pid) + 1 || 1;
      const isStatusDue = lastStatus === null || now - lastStatus >= statusMs;
      if (isStatusDue) {
        onWait(waitLine(budget, holders, position, waitedMs));
        lastStatus = now;
      }
      const hasTimedOut = waitTimeoutMs > 0 && waitedMs >= waitTimeoutMs;
      if (hasTimedOut) {
        const error = new Error(`chemx test: queued too long (${Math.round(waitedMs / 1000)}s), held by ${holderList(holders)}`);
        error.code = SLOT_WAIT_TIMEOUT_CODE;
        throw error;
      }
      const shouldReturnQueued = options.returnQueuedAfterMs !== undefined && waitedMs >= options.returnQueuedAfterMs;
      if (shouldReturnQueued) {
        const retryCommand = options.retryCommand || 'chemx test';
        return { queued: true, workers: 0, budget, queuedMs: waitedMs, nested: false, position, holders, retryCommand, release: () => {} };
      }
      const isAborted = Boolean(options.signal?.aborted);
      if (isAborted) throw new Error('chemx test: cancelled while waiting for a test slot');
      await delay(options.pollMs ?? SLOT_DEFAULTS.pollMs);
    }
  } finally {
    finish();
  }
};
