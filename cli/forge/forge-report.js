// Text for `chemx patterns --forge` (design doc, Surfaces: one line per group, then one rejected-summary
// line by reason code). Naming, placement and blueprints are P5, so a line names the group by its id,
// path and kind, and points at its first site:
//   1. 3f2a9c0d1b4e5f60 W window | 13 sites/1 file | E68 mass35 holes 4 | cli/team/team-flags.js:43 | drift 1, dependsOn 1
// --rejected lists the turned-away groups the same way with their reason codes; --explain=<id> prints a
// group's holes, captures, members by role and its codes.
import { REJECT_CODES } from './rejects.js';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const siteOf = (instance) => `${instance.file}:${instance.startLine}`;

const evidenceText = (group) => `E${Math.round(group.evidence * 10) / 10} mass${group.mass} holes ${group.lgg?.holes.length ?? 0}`;

const notesOf = (group) => [
  [group.drift?.length, 'drift'],
  [group.dependsOn?.length, 'dependsOn'],
  [group.evicted?.length, 'evicted']
].filter(([count]) => count > 0).map(([count, label]) => `${label} ${count}`).join(', ');

const sitesText = (group) => `${plural(group.memberCount, 'site')}/${plural(group.fileCount, 'file')}`;

/** One line for an accepted group: rank, id, path and kind, sites, evidence, first site, notes. */
export const groupLine = (group) => {
  const notes = notesOf(group);
  const head = `${group.rank ?? '-'}. ${group.id} ${group.path} ${group.kind}`;
  return [head, sitesText(group), evidenceText(group), siteOf(group.instances[0]), notes].filter(Boolean).join(' | ');
};

/** One line for a rejected group: id, path and kind, sites, its reason and every failing code. */
export const rejectedLine = (group) => {
  const codes = (group.rejectCodes ?? []).join(',');
  const reason = codes && codes !== group.rejectReason ? `${group.rejectReason} (${codes})` : group.rejectReason;
  return [`${group.id} ${group.path} ${group.kind}`, sitesText(group), `rejected ${reason}`, siteOf(group.instances[0])].join(' | ');
};

const codeOrder = (code) => {
  const index = REJECT_CODES.indexOf(code);
  return index === -1 ? REJECT_CODES.length : index;
};

/** The rejected-summary line: counts per reason code, R1-R8 first. */
export const rejectedSummary = (byCode) => {
  const entries = Object.entries(byCode).sort(([a], [b]) => codeOrder(a) - codeOrder(b) || Number(a > b) - Number(a < b));
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const parts = entries.map(([code, count]) => `${code} ${count}`).join(', ');
  return total === 0 ? 'rejected: none' : `rejected ${total}: ${parts} (--rejected lists them)`;
};

const holeLine = (hole) => `  ${hole.id} ${hole.kind}${hole.occurrences > 1 ? ` x${hole.occurrences}` : ''}: ${hole.examples.join(' | ')}`;

const spanLine = (role) => (span) => `  ${role} ${span.file}:${span.startLine}-${span.endLine}${span.reason ? ` (${span.reason})` : ''}`;

/** Lines of `--explain=<id>`: header, codes, holes, captures and members by role. */
export const explainLines = (group) => {
  const lgg = group.lgg;
  const captures = (lgg?.captures ?? []).map((capture) => `${capture.name}${capture.isWritten ? ' (written)' : ''}`).join(', ');
  return [
    group.status === 'rejected' ? rejectedLine(group) : groupLine(group),
    `status ${group.status}; codes ${(group.rejectCodes ?? []).join(',') || 'none'}; score ${Math.round((group.score ?? 0) * 10) / 10}`,
    lgg ? `lgg over ${lgg.memberCount} members, hole ratio ${Math.round(lgg.holeRatio * 100) / 100}` : 'lgg: none (an L1 or template group is judged without one)',
    ...(lgg?.holes ?? []).map(holeLine),
    ...(captures ? [`captures: ${captures}`] : []),
    ...group.instances.map((instance) => spanLine('member')({ ...instance, reason: null })),
    ...(group.drift ?? []).map(spanLine('drift')),
    ...(group.evicted ?? []).map(spanLine('evicted')),
    ...((group.dependsOn ?? []).length > 0 ? [`dependsOn: ${group.dependsOn.join(', ')}`] : [])
  ];
};
