// The heavy lane's line, kept as files beside the slot files (job line spec 2026-10-13, sections
// 1-2): `seq` counts tickets, `ticket-<seq>` is a heavy job waiting or running, `join-<seq>-<pid>-<id>`
// is a caller waiting for that ticket's result, and `result-<seq>` is the owner's result for its
// joiners. Old chemx reads only `slot-<n>` and ignores all of these. Every function is synchronous;
// callers that read and then write call them inside withMutex, so no two processes interleave.
import fs from 'node:fs';
import path from 'node:path';
import { isLive, readHolder, resolveTestBudget, SLOT_DEFAULTS } from './slot-files.js';

const DEFAULT_LIGHT_RESERVE = 2;
const SEQ_IN_NAME = /^(?:ticket|join|result)-(\d+)/;

// The budget splits into heavy slots (0..heavy-1) and a light reserve (CHEMX_LIGHT_RESERVE,
// default 2). With a budget of 2 or more each lane keeps at least one slot; a budget of 1 is all heavy.
export const resolveLanes = (env = process.env, budget = resolveTestBudget(env)) => {
  const fromEnv = Number(env.CHEMX_LIGHT_RESERVE);
  const hasOverride = Boolean(env.CHEMX_LIGHT_RESERVE) && Number.isInteger(fromEnv) && fromEnv >= 0;
  const asked = hasOverride ? fromEnv : DEFAULT_LIGHT_RESERVE;
  const canSplit = budget >= 2;
  const reserve = canSplit ? Math.min(Math.max(asked, 1), budget - 1) : 0;
  return { budget, heavy: Math.max(1, budget - reserve), reserve };
};

const namesIn = (dir) => {
  const hasDir = fs.existsSync(dir);
  return hasDir ? fs.readdirSync(dir) : [];
};
const seqOfName = (name) => Number(SEQ_IN_NAME.exec(name)?.[1] ?? 0);
const ticketFile = (dir, seq) => path.join(dir, `ticket-${seq}`);
const resultFile = (dir, seq) => path.join(dir, `result-${seq}`);
// The pid names the joiner's process; the token prefix tells two callers in one process apart (an
// MCP server serving two calls), which would otherwise write the same file.
const joinFile = (dir, seq, record) => path.join(dir, `join-${seq}-${record.pid}-${String(record.token).slice(0, 8)}`);
const bySeq = (a, b) => a.seq - b.seq;
const bySince = (a, b) => a.since - b.since || String(a.token).localeCompare(String(b.token));

// Reads every file named `<prefix>...`, removes the ones whose holder is gone (dead pid or stale
// heartbeat), and returns the live records.
const liveRecords = (dir, prefix, now, staleMs) => {
  const live = [];
  for (const name of namesIn(dir)) {
    const isMatch = name.startsWith(prefix);
    if (!isMatch) continue;
    const file = path.join(dir, name);
    const record = readHolder(file);
    const isRecordLive = isLive(record, now, staleMs);
    if (isRecordLive) live.push(record);
    else fs.rmSync(file, { force: true });
  }
  return live;
};

// The next ticket number. The highest seq on disk is a floor, so a lost or garbled counter file
// never hands out a seq that is still in use.
export const nextSeq = (dir) => {
  const counterFile = path.join(dir, 'seq');
  const counted = Number(readHolder(counterFile)) || 0;
  const highestOnDisk = Math.max(0, ...namesIn(dir).map(seqOfName));
  const seq = Math.max(counted, highestOnDisk) + 1;
  fs.writeFileSync(counterFile, String(seq));
  return seq;
};

export const writeTicket = (dir, seq, record) => fs.writeFileSync(ticketFile(dir, seq), JSON.stringify({ ...record, seq }));

export const readTicket = (dir, seq) => readHolder(ticketFile(dir, seq));

export const liveTickets = (dir, now, staleMs) => liveRecords(dir, 'ticket-', now, staleMs).sort(bySeq);

export const writeJoin = (dir, seq, record) => fs.writeFileSync(joinFile(dir, seq, record), JSON.stringify({ ...record, seq }));

export const liveJoins = (dir, seq, now, staleMs) => liveRecords(dir, 'join-', now, staleMs).filter((join) => join.seq === seq).sort(bySince);

export const writeResult = (dir, seq, result) => fs.writeFileSync(resultFile(dir, seq), JSON.stringify({ ...result, seq, writtenAt: Date.now() }));

export const readResult = (dir, seq) => readHolder(resultFile(dir, seq));

// A joiner leaves (it read the result, gave up or took the ticket over): its join file goes, and so
// does the result once no live joiner is left to read it.
export const leaveJoin = (dir, seq, record, now, staleMs) => {
  fs.rmSync(joinFile(dir, seq, record), { force: true });
  const isLastReader = liveJoins(dir, seq, now, staleMs).length === 0;
  if (isLastReader) fs.rmSync(resultFile(dir, seq), { force: true });
};

// The owner is done with `seq` (finished, gave up or failed): the ticket goes, dead joiners' files
// go, and the result goes unless a live joiner has still to read it.
export const clearTicket = (dir, seq, now = Date.now(), staleMs = SLOT_DEFAULTS.staleMs) => {
  fs.rmSync(ticketFile(dir, seq), { force: true });
  const hasReaders = liveJoins(dir, seq, now, staleMs).length > 0;
  if (!hasReaders) fs.rmSync(resultFile(dir, seq), { force: true });
};

// A result nobody is left to read (its joiners died before reading it) goes once it is older than
// the stale window.
const sweepResults = (dir, joins, now, staleMs) => {
  for (const name of namesIn(dir)) {
    const isResult = name.startsWith('result-');
    if (!isResult) continue;
    const seq = seqOfName(name);
    const writtenAt = readHolder(path.join(dir, name))?.writtenAt ?? 0;
    const hasReaders = joins.some((join) => join.seq === seq);
    const isAbandoned = !hasReaders && now - writtenAt > staleMs;
    if (isAbandoned) fs.rmSync(path.join(dir, name), { force: true });
  }
};

// The line in seq order as every caller sees it: the live tickets, plus a placeholder for each seq
// whose ticket is gone with no result while its joiners live. Its oldest joiner is about to take it
// over with the same seq, so the placeholder keeps that place and no later ticket starts first.
export const currentLine = (dir, now, staleMs) => {
  const tickets = liveTickets(dir, now, staleMs);
  const joins = liveRecords(dir, 'join-', now, staleMs).sort(bySince);
  sweepResults(dir, joins, now, staleMs);
  const placed = new Set(tickets.map((ticket) => ticket.seq));
  const takeovers = [];
  for (const join of joins) {
    const hasResult = fs.existsSync(resultFile(dir, join.seq));
    const isPlaced = placed.has(join.seq) || hasResult;
    if (isPlaced) continue;
    placed.add(join.seq);
    takeovers.push({ ...join, state: 'waiting', takeover: true });
  }
  return { tickets, joins, entries: [...tickets, ...takeovers].sort(bySeq) };
};
