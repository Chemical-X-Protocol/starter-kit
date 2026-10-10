/**
 * unknown-flags.js: reject unknown long flags before a command handler runs.
 * Single responsibility: check `--flag` tokens against the command's schema entry.
 *
 * Guarantees: audit, project, json, mcp, install-mcp and batch are checked strictly against the
 * schema entry plus EXTRA_FLAGS (flags their handlers read that the entry does not list). team, pkg,
 * diff, log and show are typo-checked only (TYPO_CHECKED); git flags there are suggestion candidates.
 * For a command not in PASSTHROUGH_COMMANDS, a `--flag` token before `--` that the
 * schema entry does not list is reported, with the closest listed flag when
 * one is similar. An entry that lists no long flag rejects every long flag. Not guaranteed:
 * short flags are not checked on exempt or git/pkg commands, the schema entry may lag a handler (then a real flag is
 * rejected until the entry lists it), and exempt commands keep whatever their handler does with
 * unknown flags. `chemx <cmd> --help` states the exemption (see exemptionNote).
 */

import { findCommandSchema } from '../commands-schema.js';

/** Commands whose handler forwards args to another tool or owns its own subcommand parser. */
export const PASSTHROUGH_COMMANDS = {
  build: 'passes args after the command through to the wrapped tool',
  test: 'passes args through to the test runner',
  typecheck: 'passes args through to the type checker',
  lint: 'passes args through to the linter',
  team: 'owns its subcommand parsers',
  diff: 'passes args through to git',
  log: 'passes args through to git',
  show: 'passes args through to git',
  pkg: 'passes args through to the package manager',
};

/**
 * Exempt commands that still get a typo check: an unknown long flag is rejected only when it is
 * close to a flag chemx knows (schema entry, EXTRA_FLAGS or a global one). A flag that is not
 * close to any is left to the handler or the wrapped tool, so git's own flags pass.
 */
export const TYPO_CHECKED = new Set(['team', 'diff', 'log', 'show', 'pkg']);

/** Commands that forward their args to git; short flags are never checked on them. */
const GIT_COMMANDS = new Set(['diff', 'log', 'show']);

/** Common git flags, used only as did-you-mean candidates (never to accept or reject). */
const GIT_FLAGS = [
  '--oneline', '--stat', '--staged', '--cached', '--name-only', '--name-status', '--graph', '--patch',
  '--shortstat', '--numstat', '--summary', '--decorate', '--all', '--author', '--since', '--until',
  '--grep', '--follow', '--no-merges', '--merges', '--reverse', '--abbrev-commit', '--pretty',
  '--format', '--color', '--no-color', '--word-diff', '--diff-filter', '--check', '--relative'
];

/** Flags handlers accept that the schema entry does not list; used only as typo candidates. */
const EXTRA_FLAGS = {
  audit: [
    '--staged-delta', '--non-interactive', '--no-interactive', '--ci', '--headless', '--yes', '--md', '--share',
    '--post', '--prompt-on-fail', '--copy-prompt', '--stage', '--relax', '--draft', '--dir', '--output',
    '--min-score', '--model', '--cost-per-million', '--staged', '--fast', '--quick', '--full', '--deep', '--all',
    '--include-tests', '--tests', '--no-index', '--no-fingerprint', '--triage', '--clones', '--clone-threshold',
    '--hotspot-graph', '--limit', '--all-packages', '--full-only', '--concurrency', '--scope', '--since'
  ],
  // Flags still here are not yet in a schema entry; none is verified as a user flag unless noted.
  // conflicts: the router's `d --conflicts` token, read in conflicts-cli.js; not a flag of `conflicts` itself.
  conflicts: ['--conflicts'],
  // trend, patterns, hook, init, create, generate: the handler source names these but the read was not traced.
  trend: ['--limit'],
  init: ['--preset', '--write'],
  create: ['--write'],
  generate: ['--headless', '--ci', '--non-interactive', '--no-interactive', '--write', '--install'],
  hook: ['--write'],
  // trend, badge and verify live in cli/commands-schema-verify.js (task #4493's file): move these there after it lands.
  badge: ['--grade', '--label', '--report-url', '--discussion', '--format', '--copy'],
  verify: ['--allow-empty', '--all-packages', '--timeout', '--profile'],
  patterns: ['--name'],
  // Flags the team subcommands parse (dispatch, task, tokens, audit-run, migrate, inbox/dm/feed, lock), so the
  // typo check never rejects a real one as a near miss of another (#4569). Per-subcommand schemas: #4554.
  team: [
    '--run', '--task', '--status', '--repo', '--all-repos', '--type', '--purpose', '--needs', '--parent', '--desc',
    '--tasks', '--workflow', '--run-name', '--max-agents', '--per-agent', '--max-tasks-per-agent', '--record-run',
    '--workflow-run', '--find-run', '--goal', '--dry-run', '--headless', '--limit', '--rule', '--duplicate-of',
    '--cancel', '--ignore-deps', '--target', '--no-target-confirm', '--new', '--all', '--agent', '--prio',
    '--priority', '--sprint', '--moscow', '--deps', '--add-dep', '--rm-dep', '--description', '--title', '--tier',
    '--reason', '--import', '--model', '--cost', '--since', '--tokens', '--prompt-tokens', '--completion-tokens',
    '--cached-tokens', '--log', '--metadata', '--no-fail', '--strict', '--from', '--keep-ids', '--into', '--source-repo',
    '--drop-junk', '--mark-read', '--thread', '--to', '--append', '--overwrite', '--in-place', '--compact',
    '--projects', '--url', '--pid', '--force'
  ]
};

/** Short flags a handler reads beyond COMMON_SHORT_FLAGS and its schema entry. */
const EXTRA_SHORT_FLAGS = {
  audit: ['-y', '-o'],
  'install-mcp': ['-y'],
  mcp: ['-y'],
  team: ['-m', '-c', '-e', '-z', '-a', '-E', '-I', '-L', '-P', '-A', '-B', '-C']
};

/** Flags every command accepts through the shared boot path. */
const GLOBAL_FLAGS = new Set(['--help', '--version', '--project-root', '--root', '--as']);

/** Help text for an exempt command, or null when its flags are checked. */
export const exemptionNote = (name) => {
  const reason = PASSTHROUGH_COMMANDS[name];
  if (!reason) return null;
  const isTypoChecked = TYPO_CHECKED.has(name);
  const typoNote = `Only chemx's own flags are checked, and only for typos close to a known flag; any other flag is passed on unchecked (${reason}).`;
  return isTypoChecked ? typoNote : `Unknown flags are not checked for this command: ${reason}.`;
};

export const SHORT_FLAG_NOTE = 'Short flags (-x) other than -h, -j, -l, -n, -i, -F, -d, -f, -p, -s and -g, and those the command lists, are rejected.';

/** Short flags accepted on checked commands besides the ones their schema entry lists. */
const COMMON_SHORT_FLAGS = new Set(['-h', '-j', '-l', '-n', '-i', '-F', '-d', '-f', '-p', '-s', '-g']);
const SHORT_FLAG = /(?<![\w-])-[A-Za-z](?![\w-])/g;

const withExtraFlags = (entry, known) => {
  for (const extra of EXTRA_FLAGS[entry.name] ?? []) known.set(extra, known.get(extra) ?? false);
  return known;
};

/** Short flags the schema entry lists. */
/** Long flags the command accepts: its schema entry plus the handler flags in EXTRA_FLAGS. */
export const acceptedLongFlags = (entry) => withExtraFlags(entry, knownLongFlags(entry));

const knownShortFlags = (entry) => {
  const shorts = new Set([...COMMON_SHORT_FLAGS, ...(EXTRA_SHORT_FLAGS[entry.name] ?? [])]);
  for (const { flag } of entry.flags ?? []) for (const m of flag.matchAll(SHORT_FLAG)) shorts.add(m[0]);
  return shorts;
};

const LONG_FLAG = /--[a-z][a-z0-9-]*/g;

/** Edit distance where swapping two adjacent letters costs one edit (--hepl -> --help). */
const distance = (a, b) => {
  const rows = [Array.from({ length: b.length + 1 }, (_, j) => j)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(rows[i - 1][j] + 1, row[j - 1] + 1, rows[i - 1][j - 1] + cost);
      const isSwap = i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1];
      if (isSwap) row[j] = Math.min(row[j], rows[i - 2][j - 2] + 1);
    }
    rows.push(row);
  }
  return rows[a.length][b.length];
};

/** @returns {Map<string, boolean>} long flag -> whether the schema shows it taking a value */
export const knownLongFlags = (entry) => {
  const known = new Map();
  for (const { flag } of entry.flags ?? []) {
    for (const match of flag.matchAll(LONG_FLAG)) {
      const rest = flag.slice(match.index + match[0].length);
      const takesValue = /^(=|\s+<)/.test(rest);
      known.set(match[0], known.get(match[0]) || takesValue);
    }
  }
  return known;
};

export const suggestFlag = (unknown, candidates) => {
  let best = null;
  // About one edit per three letters, so a short typo does not name an unrelated flag.
  const maxDistance = Math.max(1, Math.floor(unknown.replace(/^-+/, '').length / 3));
  let bestDistance = maxDistance + 1;
  for (const candidate of candidates) {
    const d = distance(unknown, candidate);
    const isCloser = d < bestDistance;
    if (isCloser) { best = candidate; bestDistance = d; }
  }
  return best;
};

const isKnownSearchFlag = (token, known) => {
  const name = token.split('=')[0];
  const isShortKnown = ['-n', '-i', '-l', '-j', '-F', '-d', '-h'].includes(name);
  return isShortKnown || known.has(name) || GLOBAL_FLAGS.has(name);
};

/**
 * @param {string} command first CLI token (name or alias)
 * @param {string[]} rawArgs args including the command token
 * @returns {string|null} an error message, or null when nothing is rejected
 */
export const findUnknownFlag = (command, rawArgs) => {
  const entry = findCommandSchema(command);
  if (!entry) return null;
  const isExempt = Object.hasOwn(PASSTHROUGH_COMMANDS, entry.name);
  const isTypoOnly = isExempt && TYPO_CHECKED.has(entry.name);
  const isUnchecked = isExempt && !isTypoOnly;
  if (isUnchecked) return null;
  const known = withExtraFlags(entry, knownLongFlags(entry));
  const isShortUnchecked = isTypoOnly && !Object.hasOwn(EXTRA_SHORT_FLAGS, entry.name);
  const shorts = isShortUnchecked ? null : knownShortFlags(entry);
  const args = rawArgs.slice(1);
  const separator = args.indexOf('--');
  const options = separator === -1 ? args : args.slice(0, separator);
  for (let i = 0; i < options.length; i++) {
    const arg = String(options[i]);
    // `q -g <pattern>`: the token after -g/--literal is the pattern even when it starts with '-'.
    // Mirrors search-args.js: a following known flag or `--` is not taken as the pattern.
    const isLiteralFlag = entry.name === 'search' && (arg === '-g' || arg === '--literal');
    if (isLiteralFlag) {
      const next = options[i + 1] === undefined ? undefined : String(options[i + 1]);
      const isPattern = next !== undefined && !isKnownSearchFlag(next, known);
      if (isPattern) i++;
      continue;
    }
    const isBadShort = shorts !== null && /^-[A-Za-z](=.*)?$/.test(arg) && !shorts.has(arg.slice(0, 2));
    if (isBadShort) return `chemx ${entry.name}: unknown flag ${arg.slice(0, 2)}. Run \`chemx ${entry.name} --help\`.`;
    const isLongFlag = arg.startsWith('--') && arg.length > 2;
    if (!isLongFlag) continue;
    const hasInlineValue = arg.includes('=');
    const name = hasInlineValue ? arg.slice(0, arg.indexOf('=')) : arg;
    const isGitFlag = isTypoOnly && GIT_COMMANDS.has(entry.name) && GIT_FLAGS.includes(name);
    const isAccepted = known.has(name) || GLOBAL_FLAGS.has(name) || isGitFlag;
    const consumesNext = known.get(name) === true && !hasInlineValue;
    if (consumesNext) i++;
    if (isAccepted) continue;
    const gitFlags = GIT_COMMANDS.has(entry.name) ? GIT_FLAGS : [];
    const candidates = [...known.keys(), ...GLOBAL_FLAGS, ...gitFlags];
    const closest = suggestFlag(name, candidates);
    const isPassedOn = isTypoOnly && !closest;
    if (isPassedOn) continue;
    const hint = closest ? `; did you mean ${closest}?` : '';
    return `chemx ${entry.name}: unknown flag ${name}${hint} Run \`chemx ${entry.name} --help\`.`;
  }
  return null;
};
