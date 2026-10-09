/**
 * patterns-forge-cli.js: the Forge surfaces of `chemx patterns` (design doc, Surfaces). The plain
 * `chemx patterns` stays the legacy detector the roadmap reads until P5; these run behind flags:
 *   chemx patterns --forge [dir] [--include-tests] [--idioms] [--limit=N] [--path=W] [--kind=fn] [--json]
 *     refreshes the ledger, groups it (LGG, R1-R8, ranking), stores the run in pattern_groups and prints
 *     one line per ranked group, then one rejected-summary line by reason code
 *   chemx patterns --forge --rejected    lists the rejected and suppressed groups with their codes
 *   chemx patterns --forge --explain=<id>  a group's holes, captures, members by role and codes
 *   chemx patterns reject <id> --reason="..." --as=@handle
 *     suppresses a stored group (pattern_suppressions), then posts the decision to the team feed (only
 *     once the suppression is written) and links the post to it
 */
import { syncFingerprints } from '../forge/fingerprint-sync.js';
import { runForgeGroups } from '../forge/forge-groups.js';
import { explainLines, groupLine, rejectedLine, rejectedSummary } from '../forge/forge-report.js';
import { toScorerGroups } from '../forge/group-shape.js';
import { attachDecisionPost, findStoredGroup, suppressGroup } from '../forge/group-store.js';
import { TOP_SURFACED } from '../forge/rank.js';
import { openIndexDb } from '../search-schema.js';
import { openCommitDb } from '../commit/commit-record.js';
import { postFeedEvent } from '../team/team-db.js';

const flagValue = (args, name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const write = (lines) => process.stdout.write(`${lines.join('\n')}\n`);

/** argv of `chemx patterns --forge` as options. */
export const parseForgeArgs = (args) => {
  const limit = Number(flagValue(args, 'limit'));
  return {
    targetDir: args.find((arg) => !arg.startsWith('-')) ?? null,
    includeTests: args.includes('--include-tests') || args.includes('--tests'),
    includeIdioms: args.includes('--idioms'),
    showRejected: args.includes('--rejected'),
    explain: flagValue(args, 'explain') ?? null,
    limit: Number.isInteger(limit) && limit > 0 ? limit : TOP_SURFACED,
    path: flagValue(args, 'path') ?? null,
    kind: flagValue(args, 'kind') ?? null,
    json: args.includes('--json')
  };
};

const matchesFilters = (options) => (group) => {
  const isPath = !options.path || group.path.startsWith(options.path);
  const isKind = !options.kind || group.kind === options.kind;
  return isPath && isKind;
};

const byRank = (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity);

const listing = (result, options) => {
  const isWanted = matchesFilters(options);
  const ranked = result.groups.filter((group) => group.rank !== null && group.rank !== undefined && isWanted(group)).sort(byRank).slice(0, options.limit);
  const rejected = [...result.rejected, ...result.suppressed, ...result.refined].filter(isWanted);
  const rejectedLines = options.showRejected ? rejected.map(rejectedLine) : [];
  return [...ranked.map(groupLine), ...rejectedLines, rejectedSummary(result.stats.rejectedByCode)];
};

const explaining = (result, id) => {
  const every = [...result.groups, ...result.rejected, ...result.suppressed, ...result.refined];
  const matches = every.filter((group) => group.id.startsWith(id));
  const isUnique = matches.length === 1;
  if (isUnique) return explainLines(matches[0]);
  return [matches.length === 0 ? `no group ${id} in this run` : `group id ${id} is ambiguous (${matches.length} groups)`];
};

const asJson = (result) => ({
  status: 'ok',
  stats: result.stats,
  groups: toScorerGroups(result.groups).map((group, index) => ({ ...group, rank: result.groups[index].rank, score: result.groups[index].score, holes: result.groups[index].lgg?.holes ?? [], drift: result.groups[index].drift, dependsOn: result.groups[index].dependsOn, evicted: result.groups[index].evicted })),
  rejected: toScorerGroups([...result.rejected, ...result.suppressed, ...result.refined])
});

/** `chemx patterns --forge`: returns the run result (null without an index db). */
export const runPatternsForge = (args, cwd = process.cwd()) => {
  const options = parseForgeArgs(args);
  syncFingerprints(cwd, { targetDir: options.targetDir, includeTests: options.includeTests });
  const result = runForgeGroups(cwd, { includeSpecs: options.includeTests, includeIdioms: options.includeIdioms });
  if (!result) {
    write(['patterns: no index db here (run chemx q once to create it)']);
    return null;
  }
  const lines = options.explain ? explaining(result, options.explain) : listing(result, options);
  const text = options.json ? JSON.stringify(asJson(result), null, 2) : lines.join('\n');
  process.stdout.write(`${text}\n`);
  return result;
};

const postDecision = (cwd, { agent, group, reason }) => {
  const teamDb = openCommitDb(cwd);
  const post = postFeedEvent(teamDb, {
    author_id: agent,
    event_type: 'decision',
    message: `patterns reject ${group.id} (${group.path} ${group.kind}, ${group.member_count} sites): ${reason}`,
    metadata: { groupId: group.id, suppressionKey: group.suppression_key, path: group.path }
  });
  return post?.id ?? null;
};

/** `chemx patterns reject <id> --reason="..." --as=@h`: { ok, ... } and one line of output. */
export const runPatternsReject = (args, cwd = process.cwd()) => {
  const id = args.slice(1).find((arg) => !arg.startsWith('-')) ?? '';
  const reason = flagValue(args, 'reason') ?? '';
  const agent = flagValue(args, 'as') ?? process.env.CHEMX_AGENT_ID ?? '';
  const isComplete = reason.trim().length > 0 && agent.startsWith('@');
  const db = isComplete ? openIndexDb(cwd) : null;
  const found = db ? findStoredGroup(db, id) : { error: isComplete ? 'no index db here' : 'usage: chemx patterns reject <id> --reason="..." --as=@handle' };
  const suppression = found.group ? suppressGroup(db, { group: found.group, reason, agent }) : { error: found.error };
  const isRefused = Boolean(suppression.error);
  if (isRefused) {
    write([`patterns reject: ${suppression.error}`]);
    return { ok: false, error: suppression.error };
  }
  const decisionPostId = postDecision(cwd, { agent, group: found.group, reason });
  const isPosted = decisionPostId !== null;
  if (isPosted) attachDecisionPost(db, suppression, decisionPostId);
  write([`suppressed ${found.group.id} (${found.group.path} ${found.group.kind}); decision post ${decisionPostId ?? 'not recorded (no team db)'}`]);
  return { ok: true, ...suppression, decisionPostId };
};
