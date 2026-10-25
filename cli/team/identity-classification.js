/**
 * Chemical X Protocol: which chemx calls need a named identity (K16, #6761).
 * A write changes source files, project setup or shared coordination state (leases, claims, the feed,
 * commits): it is attributed to a handle, so the hooks refuse it when the handle is missing or would be
 * inherited from an orchestrator. A read only looks: it runs with no handle at all.
 * One source for the hook denials (hooks/dispatch-identity.js, hooks/session-identity.js), the declared-handle
 * recorder and audit-run's "acted as orchestrator" section. identity-classification.spec.js walks the command
 * schema and the team trees (docs-check/command-tree.js) so a new command cannot go unclassified; the tables
 * are in docs/team-dispatch.md ("Identity: which calls need a handle").
 * Guaranteed: the class of a call follows its words and flags as the router reads them. Not guaranteed: a
 * command whose class depends on config (`audit` with `autoTriage: true` files tasks without a flag), or on
 * a value the shell expands later.
 */

import { CAPSULE_PREFIXES } from '../docs-check/command-tree.js';
import { normalizeValueFlags } from './team-flag-values.js';

export const READ = 'read';
export const WRITE = 'write';
const OTHER_CLASS = { [READ]: WRITE, [WRITE]: READ };

// Top-level commands by schema name. A call may still land in the other class (WRITE_WHEN, READ_WHEN).
export const READ_COMMANDS = [
  'search', 'read', 'trace', 'backtrace', 'check',
  'verify', 'test', 'typecheck', 'lint', 'build', 'audit', 'trend', 'docs', 'doctor', 'ci',
  'diff', 'show', 'status', 'wait', 'conflicts', 'log', 'pkg', 'ls', 'json', 'batch',
  'mcp', 'team', 'ui', 'tesseract', 'patterns', 'blueprint', 'report', 'friction'
];
export const WRITE_COMMANDS = [
  'patch', 'write', 'add', 'explode', 'generate', 'commit', 'run', 'heal', 'badge', 'changelog',
  'project', 'init', 'create', 'pillars', 'hook', 'install-mcp'
];

// Read commands that write for these flags or this first word.
export const WRITE_WHEN = {
  lint: { flags: ['--fix'] },
  audit: { flags: ['--fix', '--triage', '--triage-all', '--rebaseline'] },
  doctor: { flags: ['--fix'] },
  mcp: { flags: ['--install'] },
  friction: { words: ['add', 'export'] },
  patterns: { words: ['reject'] },
  blueprint: { words: ['fill'] }
};

// Write commands that only read for this first word (or none).
export const READ_WHEN = {
  project: { words: ['status', 'learnings'], bare: true },
  changelog: { flags: ['--check', '--dry-run'] },
  hook: { prefixes: ['claude-'] }
};

// Actions the MCP tool has and the CLI does not: audit-run reads MCP calls as CLI-shaped words (audit-run-invocations.js).
export const MCP_ONLY_WRITES = ['autofix'];

// Mirror of the schema aliases (commands-schema-*.js): the hooks must not load the schema. The spec fails on drift.
export const ALIASES = {
  q: 'search', query: 'search', find: 'search', view: 'read', r: 'read', edit: 'patch',
  'add:prop': 'add', 'add:state': 'add', 'add:action': 'add', fix: 'add', unpack: 'explode',
  g: 'generate', gen: 'generate', capsule: 'generate', jig: 'generate', 'check:all': 'verify',
  tests: 'test', 'check:test': 'test', 'check:types': 'typecheck', tsc: 'typecheck', 'check:lint': 'lint', eslint: 'lint',
  wrap: 'build', trends: 'trend', badges: 'badge', d: 'diff', p: 'pkg', f: 'ls', j: 'json', do: 'batch',
  server: 'mcp', 'mcp-server': 'mcp', 'setup-mcp': 'install-mcp',
  swarm: 'team', feed: 'team', tokens: 'team', telemetry: 'team', benchmark: 'team', ablation: 'team', memory: 'team',
  coordinator: 'project', scaffold: 'create', 'config:pillars': 'pillars', rules: 'pillars',
  dashboard: 'ui', preview: 'ui', cube: 'tesseract', matrix: 'tesseract',
  hooks: 'hook', 'install-hooks': 'hook', 'setup-ci': 'hook'
};

// The tokens that hand their words to `chemx team` (cmd-router.js), with the subcommand they stand for.
export const TEAM_FRONT_DOORS = {
  team: [], swarm: [], feed: [],
  tokens: ['tokens'], telemetry: ['tokens'], benchmark: ['benchmark'], ablation: ['benchmark'], memory: ['benchmark']
};

// `chemx team <sub>`: task and lock depend on their action; every other word below is listed by what it does.
export const TEAM_READS = ['status', 'tokens', 'telemetry', 'feed', 'benchmark', 'ablation', 'memory', 'route', 'audit-run', 'help'];
export const TEAM_WRITES = ['post', 'unlock', 'triage', 'inbox', 'dm', 'train', 'profile', 'handoff', 'dispatch', 'migrate'];
export const TEAM_BY_ACTION = ['task', 'lock'];
export const TASK_READS = ['list', 'show', 'view', 'info'];
export const TASK_WRITES = [
  'comment', 'post', 'vds-slot', 'slot', 'trace', 'claim', 'handoff', 'close', 'done', 'complete', 'update',
  'create', 'add', 'new', 'triage', 'reconcile', 'prune', 'set-target', 'target', 'set-files'
];
// Any other first word after `team lock` is a file path, and a path is acquired.
export const LOCK_READS = ['status', 'list', 'check-staged'];
export const LOCK_WRITES = ['acquire', 'release', 'unlock', 'check', 'renew'];

const READ_SET = new Set(READ_COMMANDS);
const WRITE_SET = new Set(WRITE_COMMANDS);
const HELP_HEADS = new Set(['help', 'version', '--help', '-h', '--version', '-v']);
const HELP_FLAGS = new Set(['--help', '-h']);

// The CLI strips --root=<dir> and --root <dir> (also --project-root) from anywhere before the router runs (cli-root.js); so does the class.
const ROOT_FLAG_NAMES = ['--root', '--project-root'];
const withoutRootFlag = (words) => {
  const kept = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const next = words[i + 1];
    const isRootAssign = ROOT_FLAG_NAMES.some((name) => word.startsWith(`${name}=`));
    const isRootPair = ROOT_FLAG_NAMES.includes(word);
    const takesNext = isRootPair && next !== undefined && !next.startsWith('-');
    const isRootFlag = isRootAssign || isRootPair;
    if (takesNext) i++;
    if (!isRootFlag) kept.push(word);
  }
  return kept;
};

const beforeTerminator = (words) => {
  const at = words.indexOf('--');
  const hasTerminator = at !== -1;
  return hasTerminator ? words.slice(0, at) : words;
};

const firstWord = (words) => beforeTerminator(words).find((word) => !word.startsWith('-'));
const hasFlag = (words, flag) => beforeTerminator(words).some((word) => word === flag || word.startsWith(`${flag}=`));

const matchesRule = (words, rule) => {
  const word = firstWord(words);
  const hasWord = word !== undefined;
  const hasFlagMatch = (rule.flags ?? []).some((flag) => hasFlag(words, flag));
  const hasWordMatch = hasWord && (rule.words ?? []).includes(word);
  const hasPrefixMatch = hasWord && (rule.prefixes ?? []).some((prefix) => word.startsWith(prefix));
  const isBareMatch = !hasWord && rule.bare === true;
  return hasFlagMatch || hasWordMatch || hasPrefixMatch || isBareMatch;
};

const positionalsOf = (words) => normalizeValueFlags(beforeTerminator(words)).args.filter((word) => !word.startsWith('-'));

const classifyTask = (words) => (TASK_WRITES.includes(positionalsOf(words)[0] ?? 'list') ? WRITE : READ);

const classifyLock = (words) => {
  const first = positionalsOf(words)[0];
  const isBare = first === undefined;
  const isListedRead = LOCK_READS.includes(first);
  return isBare || isListedRead ? READ : WRITE;
};

const TEAM_BY_ACTION_CLASSIFIERS = { task: classifyTask, lock: classifyLock };

// `words` are the words after `team`. The router takes the first word as the subcommand ('status' when none).
const classifyTeam = (words) => {
  const [sub = 'status', ...rest] = beforeTerminator(words);
  if (Object.hasOwn(TEAM_BY_ACTION_CLASSIFIERS, sub)) return TEAM_BY_ACTION_CLASSIFIERS[sub](rest);
  return TEAM_WRITES.includes(sub) ? WRITE : READ;
};

// `chemx do "write a.js" "verify"`: the batch writes when any quoted sub-command does.
export const subCommandWords = (sub) => {
  const words = String(sub ?? '').trim().split(/\s+/).filter(Boolean);
  return words[0] === 'chemx' ? words.slice(1) : words;
};

const classifyBatch = (words) => (words.some((sub) => classifyChemxArgs(subCommandWords(sub)) === WRITE) ? WRITE : READ);

const canonicalName = (token) => {
  const isListed = READ_SET.has(token) || WRITE_SET.has(token);
  if (isListed) return token;
  return Object.hasOwn(ALIASES, token) ? ALIASES[token] : undefined;
};

const isCapsuleToken = (token) => CAPSULE_PREFIXES.some((prefix) => token.startsWith(prefix));

const classifyListed = (name, words) => {
  const isWriteListed = WRITE_SET.has(name);
  const flip = isWriteListed ? READ_WHEN[name] : WRITE_WHEN[name];
  const base = isWriteListed ? WRITE : READ;
  const isFlipped = flip !== undefined && matchesRule(words, flip);
  return isFlipped ? OTHER_CLASS[base] : base;
};

const SPECIAL_CLASSIFIERS = { batch: classifyBatch };

/**
 * 'write' or 'read' for the words after the chemx binary. A help or version request is a read: the router
 * prints help and never runs the command. An unknown token is a read: the router refuses it. A capsule
 * generator (`chemx m-card`) is a write.
 */
export function classifyChemxArgs(args = []) {
  const [head, ...rest] = withoutRootFlag(args.map(String));
  const isEmpty = head === undefined;
  const isHelp = isEmpty || HELP_HEADS.has(head) || beforeTerminator(rest).some((word) => HELP_FLAGS.has(word));
  if (isHelp) return READ;
  if (Object.hasOwn(TEAM_FRONT_DOORS, head)) return classifyTeam([...TEAM_FRONT_DOORS[head], ...rest]);
  if (MCP_ONLY_WRITES.includes(head)) return WRITE;
  const name = canonicalName(head);
  const isUnknown = name === undefined;
  if (isUnknown) return isCapsuleToken(head) ? WRITE : READ;
  if (Object.hasOwn(SPECIAL_CLASSIFIERS, name)) return SPECIAL_CLASSIFIERS[name](rest);
  return classifyListed(name, rest);
}

/** True when the call changes files or shared state, so it needs a stable identity. */
export const isMutatingChemxArgs = (args = []) => classifyChemxArgs(args) === WRITE;
