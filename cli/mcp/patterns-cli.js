/**
 * patterns-cli.js: `chemx patterns` argv adapter over the MCP handleQueryPatterns handler.
 * Interim alias (Forge P0); P5 replaces it with the Forge surface.
 */
import { handleQueryPatterns } from './tools-patterns.js';
import { runPatternsScore } from '../patterns/gt-score-cli.js';
import { syncFingerprints } from '../forge/fingerprint-sync.js';
import { runForgeGroups } from '../forge/forge-groups.js';
import { toScorerGroups } from '../forge/group-shape.js';

const flagValue = (args, name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export const parsePatternsArgs = (args) => {
  const dir = args.find((a) => !a.startsWith('-'));
  const type = flagValue(args, 'type');
  const min = Number(flagValue(args, 'min'));
  const hasMin = Number.isFinite(min) && flagValue(args, 'min') !== undefined;
  return {
    ...(dir ? { dir } : {}),
    ...(type ? { type } : {}),
    ...(hasMin ? { minOccurrences: min } : {}),
    compact: !args.includes('--full')
  };
};

// `chemx patterns --sync [dir] [--include-tests]`: refreshes the Forge ledger only (no rules, no audit).
const runPatternsSync = (args, cwd) => {
  const targetDir = args.find((a) => !a.startsWith('-')) ?? null;
  const includeTests = args.includes('--include-tests') || args.includes('--tests');
  const result = syncFingerprints(cwd, { targetDir, includeTests });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
};

// `chemx patterns --groups [dir] [--include-tests] [--idioms]`: refreshes the ledger, then prints the Forge
// groups as JSON (grouping paths N1/N2/N3/W/T with gates G1-G4; LGG and ranking come later).
const runPatternsGroups = (args, cwd) => {
  const targetDir = args.find((a) => !a.startsWith('-')) ?? null;
  const includeTests = args.includes('--include-tests') || args.includes('--tests');
  const sync = syncFingerprints(cwd, { targetDir, includeTests });
  const grouped = runForgeGroups(cwd, { includeSpecs: includeTests, includeIdioms: args.includes('--idioms') });
  const result = grouped
    ? { status: 'ok', sync: { parsed: sync.parsed, ms: sync.ms }, stats: grouped.stats, groups: toScorerGroups(grouped.groups), refined: toScorerGroups(grouped.refined) }
    : { status: 'unavailable' };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
};

export const runPatternsCli = (args, cwd = process.cwd()) => {
  const isScoreRun = args.some((arg) => arg.startsWith('--score='));
  if (isScoreRun) return runPatternsScore(args, cwd);
  const isSyncRun = args.includes('--sync');
  if (isSyncRun) return runPatternsSync(args, cwd);
  const isGroupsRun = args.includes('--groups');
  if (isGroupsRun) return runPatternsGroups(args, cwd);
  const result = handleQueryPatterns(parsePatternsArgs(args), cwd);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};
