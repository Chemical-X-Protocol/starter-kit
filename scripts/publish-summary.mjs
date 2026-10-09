/**
 * Publish result summary for publish-both: one line per target and the exit
 * code. Any failed (or never-started) target makes the run fail.
 */
export const computePublishExitCode = (results = [], expectedCount = results.length) => {
  const hasEveryTarget = results.length === expectedCount && expectedCount > 0;
  const hasFailure = results.some((res) => !res.success);
  return hasEveryTarget && !hasFailure ? 0 : 1;
};

export const formatPublishSummary = (results = []) => results.map((res) => {
  const icon = res.success ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✕\x1b[0m';
  return `  ${icon} ${res.name.padEnd(25)} ${res.success ? 'Published' : 'Failed'}`;
});
