// The words the heavy line prints: who a ticket names, the waiting line a heavy caller reports, the
// ticket line of the `chemx test --slots` listing, and the note a shared result carries.
import { ANSI } from './theme.js';

// The handle (or pid) a record names, for the shared-run line and `shared.owner`.
export const ownerOf = (record) => record.handle || `pid ${record.pid}`;

// The handle (or pid) with its task when one is recorded: `@sonnet-oh2 (task 1317)`.
export const whoOf = (record) => {
  const hasTask = Boolean(record.task);
  return hasTask ? `${ownerOf(record)} (task ${record.task})` : ownerOf(record);
};

// `0s`, `42s`, `2m10s`.
export const ageText = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const isOverAMinute = minutes > 0;
  return isOverAMinute ? `${minutes}m${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
};

// What holds a waiting heavy job up: the running job, else light runs still on the heavy slots,
// else the ticket next in line.
const blockerText = (view, now) => {
  const { running } = view;
  const hasRunningJob = Boolean(running);
  if (hasRunningJob) return `running ${running.kind} for ${whoOf(running)} ${ageText(now - (running.startedAt ?? running.since))}`;
  const hasLightHolders = view.heldSlots > 0;
  if (hasLightHolders) return `light runs hold ${view.heldSlots} of ${view.heavy} heavy slots`;
  const [next] = view.ahead;
  const hasNext = Boolean(next);
  return hasNext ? `next up ${next.kind} for ${whoOf(next)}` : 'about to start';
};

// chemx: in line #2 for build (budget 6, heavy 4): running tests for @a 0s; ahead: tests
export const waitLine = (view, now = Date.now()) => {
  const ahead = view.ahead.map((entry) => entry.kind).join(', ') || 'none';
  return `chemx: in line #${view.position} for ${view.kind} (budget ${view.budget}, heavy ${view.heavy}): ${blockerText(view, now)}; ahead: ${ahead}\n`;
};

// `  line #3 running tests: @a (task 7), 12s, 2 joined` (the number is the ticket's seq).
export const ticketLine = (ticket) => `  line #${ticket.seq} ${ticket.state} ${ticket.kind}: ${whoOf(ticket)}, ${Math.round(ticket.ageMs / 1000)}s, ${ticket.joined} joined`;

// chemx: shared run (owner @sonnet-oh2, 2 joined)
export const sharedRunLine = (shared) => `chemx: shared run (owner ${shared.owner}, ${shared.joined} joined)`;

// `{ sharedRun: { owner, joined, seq } }` for a report whose result came from (or was given to) other
// callers, else nothing.
export const sharedRunField = (shared) => {
  const isShared = Boolean(shared);
  return isShared ? { sharedRun: shared } : {};
};

// The shared-run line as the last line of a human report, or nothing when the result was not shared.
// Takes any report or verify step that carries `sharedRun`.
export const sharedRunNote = (report) => {
  const isShared = Boolean(report.sharedRun);
  return isShared ? `  ${ANSI.DIM}${sharedRunLine(report.sharedRun)}${ANSI.RESET}\n` : '';
};

// The report fields of a caller that gave up queueing: nothing ran and nothing is held, so the result
// is QUEUED (inconclusive), never a pass. `grant` is the queued outcome of acquireTestSlots (holders)
// or of the heavy line (holders and ahead); `what` names what did not run ("tests", "typecheck", "build").
export const queuedFields = (grant, what) => {
  const isInLine = Array.isArray(grant.ahead);
  const busy = isInLine ? 'the heavy line was busy' : 'all test slots were busy';
  const aheadField = isInLine ? { ahead: grant.ahead } : {};
  return {
    reason: 'QUEUED', exitCode: 0, queued: true, position: grant.position, holders: grant.holders, ...aheadField, retryCommand: grant.retryCommand,
    detail: `${busy} after ${Math.round(grant.queuedMs / 1000)}s (queue position about ${grant.position}); no ${what} ran and no slot is held. Run again: ${grant.retryCommand}`
  };
};
