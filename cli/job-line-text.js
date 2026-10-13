// The words the heavy line prints: who a ticket names, the waiting line a heavy caller reports, and
// the ticket line of the `chemx test --slots` listing.

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
