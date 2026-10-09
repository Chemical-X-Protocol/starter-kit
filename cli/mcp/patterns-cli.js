/**
 * patterns-cli.js: `chemx patterns` argv adapter over the MCP handleQueryPatterns handler.
 * Interim alias (Forge P0); P5 replaces it with the Forge surface. The Forge listing, --rejected,
 * --explain and `patterns reject` run behind --forge (patterns-forge-cli.js).
 */
import { handleQueryPatterns } from './tools-patterns.js';
import { runPatternsScore } from '../patterns/gt-score-cli.js';
import { syncFingerprints } from '../forge/fingerprint-sync.js';
import { runForgeGroups } from '../forge/forge-groups.js';
import { toScorerGroups } from '../forge/group-shape.js';
import { runPatternsForge, runPatternsReject } from './patterns-forge-cli.js';

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
    ? { status: 'ok', sync: { parsed: sync.parsed, ms: sync.ms }, stats: grouped.stats, groups: toScorerGroups(grouped.groups), refined: toScorerGroups(grouped.refined), rejected: toScorerGroups([...grouped.rejected, ...grouped.suppressed]) }
    : { status: 'unavailable' };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
};

const KNOWN_FLAGS = new Set(['type', 'min', 'full', 'forge', 'sync', 'groups', 'include-tests', 'tests', 'idioms', 'rejected', 'explain', 'path', 'kind', 'limit', 'json', 'score', 'input', 'dir', 'reason', 'as']);

/** Flags (`--name` or `--name=value`) this command does not read; they are refused rather than ignored. */
export const unknownPatternsFlags = (args) => args.filter((a) => a.startsWith('--') && !KNOWN_FLAGS.has(a.slice(2).split('=')[0]));

export const runPatternsCli = (args, cwd = process.cwd()) => {
  const unknown = unknownPatternsFlags(args);
  const hasUnknown = unknown.length > 0;
  if (hasUnknown) {
    process.stderr.write(`patterns: unknown flag${unknown.length > 1 ? 's' : ''} ${unknown.join(' ')}; nothing was run. Known: ${[...KNOWN_FLAGS].map((f) => `--${f}`).join(' ')}\n`);
    process.exitCode = 2;
    return null;
  }
  const isRejectRun = args[0] === 'reject';
  if (isRejectRun) return runPatternsReject(args, cwd);
  const isScoreRun = args.some((arg) => arg.startsWith('--score='));
  if (isScoreRun) return runPatternsScore(args, cwd);
  const isForgeRun = args.includes('--forge');
  if (isForgeRun) return runPatternsForge(args, cwd);
  const isSyncRun = args.includes('--sync');
  if (isSyncRun) return runPatternsSync(args, cwd);
  const isGroupsRun = args.includes('--groups');
  if (isGroupsRun) return runPatternsGroups(args, cwd);
  const result = handleQueryPatterns(parsePatternsArgs(args), cwd);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};
