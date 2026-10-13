// One turn of a heavy caller in the line, each a single critical section under withMutex (job line
// spec 2026-10-13, rules 1, 2 and 4): enter the line (join or take a ticket), an owner's poll
// (start when first in line with the heavy slots free) and a joiner's poll (take the result, or
// take a dead owner's ticket over). The lifecycle around these turns lives in job-line.js.
import fs from 'node:fs';
import { withMutex, isLive, readHolder, slotFile } from './slot-files.js';
import { nextSeq, writeTicket, writeJoin, liveJoins, leaveJoin, readResult, currentLine } from './job-line-tickets.js';

// The record a ticket or join file holds (a ticket adds `state`, and `startedAt` once it runs).
export const recordOf = (job, now) => ({ pid: process.pid, token: job.token, since: job.since, heartbeat: now, kind: job.kind, key: job.key, ...job.identity });

const takeTicket = (job, seq, now) => {
  job.role = 'owner';
  job.seq = seq;
  writeTicket(job.dir, seq, { ...recordOf(job, now), state: 'waiting' });
};

const joinTicket = (job, seq, now) => {
  job.role = 'joiner';
  job.seq = seq;
  writeJoin(job.dir, seq, recordOf(job, now));
};

// Rule 1: join a waiting ticket with the same key, else take the next ticket.
export const enterLine = (job) => withMutex(job.dir, () => {
  const now = Date.now();
  const { entries } = currentLine(job.dir, now, job.staleMs);
  const match = entries.find((entry) => entry.state === 'waiting' && entry.key === job.key);
  const canJoin = Boolean(match);
  if (canJoin) joinTicket(job, match.seq, now);
  else takeTicket(job, nextSeq(job.dir), now);
});

const heavySlotsHeld = (job, now) => {
  let held = 0;
  for (let index = 0; index < job.heavy; index++) {
    const isHeld = isLive(readHolder(slotFile(job.dir, index)), now, job.staleMs);
    if (isHeld) held++;
  }
  return held;
};

// A running ticket is ahead of everyone; a waiting one only of the tickets after it.
const isAheadOf = (entry, seq) => {
  const isOther = entry.seq !== seq;
  const isRunning = entry.state === 'running';
  return isOther && (isRunning || entry.seq < seq);
};

const viewOf = (job, entries, now) => {
  const ahead = entries.filter((entry) => isAheadOf(entry, job.seq));
  const running = entries.find((entry) => entry.state === 'running') ?? null;
  return { kind: job.kind, budget: job.budget, heavy: job.heavy, position: ahead.length + 1, ahead, running, heldSlots: heavySlotsHeld(job, now) };
};

// Rule 2: claim the heavy slots (light-slot record shape plus `seq`) and turn the ticket running.
const startTicket = (job, ticket, now) => {
  for (let index = 0; index < job.heavy; index++) {
    const file = slotFile(job.dir, index);
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token: job.token, since: now, heartbeat: now, ...job.identity, seq: job.seq }));
    job.slotFiles.push(file);
  }
  writeTicket(job.dir, job.seq, { ...ticket, state: 'running', startedAt: now, heartbeat: now });
};

// Our ticket was swept as stale (our heartbeat lapsed while we lived). If a joiner already took it
// over we join that run; otherwise we put the ticket back under the same seq.
const recoverTicket = (job, holder, now) => {
  const isTakenOver = Boolean(holder);
  if (isTakenOver) joinTicket(job, job.seq, now);
  else takeTicket(job, job.seq, now);
};

const ownerTurn = (job) => withMutex(job.dir, () => {
  const now = Date.now();
  const { entries } = currentLine(job.dir, now, job.staleMs);
  const holder = entries.find((entry) => entry.seq === job.seq && !entry.takeover);
  const view = viewOf(job, entries, now);
  const isOurTicket = holder?.token === job.token;
  const canStart = isOurTicket && view.ahead.length === 0 && view.heldSlots === 0;
  if (!isOurTicket) recoverTicket(job, holder, now);
  if (canStart) startTicket(job, holder, now);
  return { isFinal: canStart, view };
});

// Rule 4 takeover: the ticket is gone with no result (its owner died or gave up). The oldest live
// joiner takes it over under the same seq, so it keeps its place; the others keep waiting on it.
const takeOverIfOldest = (job, now) => {
  const joins = liveJoins(job.dir, job.seq, now, job.staleMs);
  const isSwept = !joins.some((join) => join.token === job.token);
  if (isSwept) writeJoin(job.dir, job.seq, recordOf(job, now));
  const [oldest] = liveJoins(job.dir, job.seq, now, job.staleMs);
  const isOldest = oldest?.token === job.token;
  if (isOldest) {
    leaveJoin(job.dir, job.seq, recordOf(job, now), now, job.staleMs);
    takeTicket(job, job.seq, now);
  }
};

const joinerTurn = (job) => withMutex(job.dir, () => {
  const now = Date.now();
  const stored = readResult(job.dir, job.seq);
  const hasResult = Boolean(stored);
  if (hasResult) {
    leaveJoin(job.dir, job.seq, recordOf(job, now), now, job.staleMs);
    job.role = 'done';
    const shared = { owner: stored.owner, joined: stored.joined, seq: job.seq };
    return { isFinal: true, value: { result: stored.result, workers: stored.workers, budget: job.budget, queuedMs: now - job.start, shared } };
  }
  const { entries } = currentLine(job.dir, now, job.staleMs);
  const hasTicket = entries.some((entry) => entry.seq === job.seq && !entry.takeover);
  if (!hasTicket) takeOverIfOldest(job, now);
  return { isFinal: false, view: viewOf(job, entries, now) };
});

export const TURNS = { owner: ownerTurn, joiner: joinerTurn };
