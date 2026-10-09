/**
 * Chemical X Protocol: the text report of `chemx team migrate` (#2488, #2581). Pure formatting.
 * Lists, by key, every row the board kept instead of the source's, every junk row dropped and every
 * row whose reference was cleared, plus every task target kept as written because it leaves the root.
 * Long lists print the first LIST_LIMIT keys and say how many more --json holds.
 */

const LIST_LIMIT = 50;

const listKeys = (keys) => {
  const shown = keys.slice(0, LIST_LIMIT).join(', ');
  const more = keys.length - LIST_LIMIT;
  return more > 0 ? `${shown}, ... and ${more} more (--json lists all)` : shown;
};

const describeTables = (tables) => Object.entries(tables)
  .filter(([, counts]) => counts.pending + counts.alreadyMerged + counts.junk > 0)
  .map(([table, counts]) => `  ${table}: ${counts.pending} to merge, ${counts.alreadyMerged} already merged, ${counts.renumbered} renumbered, ${counts.junk} junk candidates`);

const countLine = (table, counts) => {
  const merged = counts.merged > 0 ? `, merged into the board row ${counts.merged}` : '';
  return `  applied ${table}: inserted ${counts.inserted}${merged}, kept board row instead ${counts.conflicts}, dangling refs dropped ${counts.dangling}`;
};

const keyLines = (table, counts) => [
  [counts.conflictsKeys, `    kept board row instead (${table}): `],
  [counts.mergedKeys, `    merged into the board row (${table}): `],
  [counts.droppedKeys, `    dropped as junk (${table}): `],
  [(counts.danglingRefs ?? []).map((ref) => `${ref.key} (${ref.columns.join(', ')})`), `    reference cleared (${table}): `]
].filter(([keys]) => (keys ?? []).length > 0).map(([keys, lead]) => `${lead}${listKeys(keys)}`);

// What the insert really did, per table. A conflict is a source row the board already had a row for:
// the board row stays, the source row is not inserted, and it is not retried on a re-run.
const describeApplied = (applied) => {
  const rows = Object.entries(applied?.tables ?? {}).filter(([, counts]) => counts.inserted + counts.conflicts + (counts.merged ?? 0) + counts.dangling + (counts.droppedKeys ?? []).length > 0);
  const lines = rows.flatMap(([table, counts]) => [countLine(table, counts), ...keyLines(table, counts)]);
  const conflicted = rows.filter(([, counts]) => counts.conflicts > 0).map(([table]) => table);
  const hasConflicts = conflicted.length > 0;
  const warning = hasConflicts ? [`  WARNING: source rows were not inserted in ${conflicted.join(', ')} (an existing board row has the same key, e.g. a lease on the same file; keys listed above). They are not retried on a re-run; check them by hand.`] : [];
  const remapped = applied?.boardMetadataRemapped > 0 ? [`  board feed rows whose metadata task ids followed the renumber: ${applied.boardMetadataRemapped}`] : [];
  return [...lines, ...warning, ...remapped];
};

const describeTargets = (targets) => {
  const repos = Object.entries(targets.byRepo).map(([repo, count]) => `${repo}: ${count}`).join(', ') || 'none';
  const details = targets.escapingDetails ?? targets.escapingTargets.map((id) => ({ id, target: '?', kind: 'unknown' }));
  const head = `  task repos after the merge: ${repos}; ${targets.normalized} target(s) re-based to their owning package`;
  const hasEscaping = details.length > 0;
  if (!hasEscaping) return [head];
  const byKind = (kind) => details.filter((detail) => detail.kind === kind).length;
  const lead = `  targets kept as written because they leave the root: ${details.length} (relative ../: ${byKind('relative')}, absolute: ${byKind('absolute')})`;
  return [head, lead, ...details.map((detail) => `    #${detail.id} ${detail.target}`)];
};

const describeBackups = (report) => {
  const isNothing = Boolean(report.nothingToMerge);
  if (isNothing) return '  backups: none (nothing to merge, nothing was written)';
  const hasBackups = report.backups.length > 0;
  if (!hasBackups) return '  backups: none (dry run)';
  const onlySource = report.backups.length === 1 ? ' (the coordination db did not exist yet, so only the source was copied)' : '';
  return `  backups: ${report.backups.join(', ')}${onlySource}`;
};

const modeOf = (report) => {
  const isDry = Boolean(report.dryRun);
  if (isDry) return 'dry run, nothing written';
  return report.nothingToMerge ? 'nothing to merge' : 'merged';
};

export const formatMigrateReport = (report) => {
  const mode = modeOf(report);
  const junkLine = report.junk.length > 0
    ? `  junk candidates: ${report.junk.length} (${report.junkDropped ? 'dropped' : 'kept; --drop-junk drops them'}): ${report.junk.slice(0, 10).map((j) => `${j.table}:${j.key} (${j.reason})`).join(', ')}${report.junk.length > 10 ? ', ...' : ''}`
    : '  junk candidates: 0';
  const nothing = report.nothingToMerge ? ['  nothing to merge: every source row is already on the board (or the source has none); no backup was taken and the coordination db was not opened for writing'] : [];
  const lines = [
    `Team merge (${mode}): ${report.source.path} (repo ${report.source.repo}) -> ${report.target.path}`,
    `  keep ids: ${report.keepIds}; first merge of this source: ${report.isFirstRun ? 'yes' : 'no'}; board tasks renumbered: ${report.boardRenumbered}`,
    ...nothing,
    ...describeTables(report.tables),
    ...describeApplied(report.applied),
    ...describeTargets(report.targets),
    junkLine,
    `  source tasks changed after the previous merge (not re-synced): ${report.changedAfterMerge}`,
    describeBackups(report),
    '  remapped: task ids in structured fields and in feed metadata JSON (taskIds, resolvedTaskIds, duplicate_of, queueId). Not rewritten: free text (#ids in titles, messages, task_url); task show resolves old ids through task_aliases.'
  ];
  return `${lines.join('\n')}\n`;
};
