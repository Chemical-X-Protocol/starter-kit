// `chemx patterns --score=<labels.json>`: score a detector against the content-anchored ground truth.
// Default detector is the legacy audit pattern detector (the recorded baseline); `--input=<groups.json>` scores
// any other detector's groups ([{ id, path, occurrences: [{ file, startLine, endLine }] }]); `--forge` scores the
// Forge grouping (cli/forge/forge-groups.js) after refreshing the ledger the way `patterns --forge` does, so the
// score never depends on what an earlier run left in it (#2603); `--include-tests` syncs and groups the spec
// facet too (the A16 and A17 items live in specs).
import fs from 'node:fs';
import path from 'node:path';
import { handleQueryPatterns } from '../mcp/tools-patterns.js';
import { loadLabels, resolveLabels, staleAnchorIds, retiredAnchorIds, mismatchedAnchorIds } from './gt-resolve.js';
import { scoreGroups } from './gt-score.js';
import { runForgeGroups } from '../forge/forge-groups.js';
import { toScorerGroups } from '../forge/group-shape.js';
import { syncFingerprints } from '../forge/fingerprint-sync.js';

const flagValue = (args, name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

export const legacyGroups = (candidates) => candidates.map((candidate) => ({
  id: candidate.id,
  path: 'legacy',
  type: candidate.type,
  occurrences: (candidate.occurrences ?? []).map((occ) => ({ file: occ.filePath, startLine: occ.line, endLine: occ.line }))
}));

// dir is omitted when not given, so the scored scan scope is the same default as plain `chemx patterns`.
const readLegacy = (dir, cwd) => legacyGroups(handleQueryPatterns({ ...(dir ? { dir } : {}), compact: false }, cwd).candidates);

const readForge = (args, cwd) => {
  const includeTests = args.includes('--include-tests') || args.includes('--tests');
  syncFingerprints(cwd, { includeTests });
  return toScorerGroups(runForgeGroups(cwd, { includeSpecs: includeTests })?.groups ?? []);
};

const readGroups = (args, cwd) => {
  const isForge = args.includes('--forge');
  if (isForge) return readForge(args, cwd);
  const input = flagValue(args, 'input');
  const dir = flagValue(args, 'dir') ?? args.find((arg) => !arg.startsWith('-'));
  return input ? JSON.parse(fs.readFileSync(path.resolve(cwd, input), 'utf-8')) : readLegacy(dir, cwd);
};

const percent = (value) => (value === null ? 'n/a' : `${(value * 100).toFixed(0)}%`);

export const formatScore = (report, staleIds, mismatchIds = [], retiredIds = []) => {
  const { recallA, falseItems, precision } = report;
  const surfacedList = falseItems.surfaced.join(' ');
  const lines = [
    `groups ${report.groups}: ${precision.trueGroups} true, ${precision.falseGroups} false (B-class), ${precision.unlabeledGroups} unlabeled`,
    `A recall ${recallA.credit}/${recallA.items} = ${percent(recallA.recall)} (found ${recallA.found}, partial ${recallA.partial}, missed ${recallA.missed})`,
    `A recall by scope: code ${report.recallByScope.code.credit}/${report.recallByScope.code.items}, spec ${report.recallByScope.spec.credit}/${report.recallByScope.spec.items}`,
    `healed items (${report.healedItems.length}, excluded from recall): ${report.healedItems.join(' ')}`,
    `B surfaced ${falseItems.surfacedCount}/${falseItems.items} ${surfacedList}`,
    `precision labeled ${percent(precision.labeled)}, overall ${percent(precision.overall)}`,
    `by type: ${Object.entries(report.byType).map(([type, count]) => `${type} ${count}`).join(', ')}`
  ];
  for (const [name, row] of Object.entries(report.perPath)) {
    lines.push(`path ${name}: ${row.groups} groups, ${row.true} true, ${row.false} false, ${row.borderline} borderline, ${row.unlabeled} unlabeled, item credit ${row.itemCredit}`);
  }
  const hasRetired = retiredIds.length > 0;
  if (hasRetired) lines.push(`retired anchors (${retiredIds.length}, intentional, each cites a commit in labels.json): ${retiredIds.join(' ')}`);
  const hasStale = staleIds.length > 0;
  if (hasStale) lines.push(`stale anchors (${staleIds.length}): ${staleIds.join(' ')}`);
  const hasMismatch = mismatchIds.length > 0;
  if (hasMismatch) lines.push(`fixture/label hash mismatch (${mismatchIds.length}): ${mismatchIds.join(' ')}`);
  return `${lines.join('\n')}\n`;
};

export const runPatternsScore = (args, cwd = process.cwd()) => {
  const labelsPath = path.resolve(cwd, flagValue(args, 'score') ?? '');
  const labels = loadLabels(labelsPath);
  const items = resolveLabels(labels, path.dirname(labelsPath), cwd);
  const report = scoreGroups(items, readGroups(args, cwd));
  const staleIds = staleAnchorIds(items);
  const mismatchIds = mismatchedAnchorIds(items);
  const retiredIds = retiredAnchorIds(items);
  const wantsJson = args.includes('--json');
  const text = wantsJson ? `${JSON.stringify({ ...report, staleAnchors: staleIds, retiredAnchors: retiredIds, mismatchedAnchors: mismatchIds }, null, 2)}\n` : formatScore(report, staleIds, mismatchIds, retiredIds);
  process.stdout.write(text);
  return report;
};
