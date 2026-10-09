// Tri-state result contract shared by verify, test, typecheck, build, batch, search and MCP.
// A result is only PASS when something proved it; anything unproven is INCONCLUSIVE.

export const STATUS = Object.freeze({ PASS: 'pass', FAIL: 'fail', INCONCLUSIVE: 'inconclusive' });

export const EXIT_CODES = Object.freeze({ pass: 0, fail: 1, inconclusive: 3 });

export const toExitCode = (status) => EXIT_CODES[status] ?? EXIT_CODES.fail;

export const isPass = (status) => status === STATUS.PASS;

// Worst status wins: fail > inconclusive > pass. An empty list proves nothing.
export const combineStatuses = (statuses) => {
  const hasNoStatuses = statuses.length === 0;
  if (hasNoStatuses) return STATUS.INCONCLUSIVE;
  const hasFailure = statuses.includes(STATUS.FAIL);
  if (hasFailure) return STATUS.FAIL;
  const hasUnproven = statuses.some((status) => status !== STATUS.PASS);
  return hasUnproven ? STATUS.INCONCLUSIVE : STATUS.PASS;
};

export const inconclusive = (reason, extra = {}) => ({ status: STATUS.INCONCLUSIVE, reason, ...extra });
