/**
 * unknown-flags.js: reject unknown long flags before a command handler runs.
 * Single responsibility: check `--flag` tokens against the command's schema entry.
 *
 * Guarantees: for a command not in PASSTHROUGH_COMMANDS, a `--flag` token before `--` that the
 * schema entry does not list is reported, with the closest listed flag when
 * one is similar. An entry that lists no long flag rejects every long flag. Not guaranteed:
 * short flags (-x) are not checked here, the schema entry may lag a handler (then a real flag is
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
  audit: 'the handler and the pre-commit hook pass flags its schema entry does not list (--staged-delta, --non-interactive)',
  batch: 'runs other chemx commands, each validated on its own',
  team: 'owns its subcommand parsers',
  project: 'owns its subcommand parsers',
  mcp: 'MCP server and installer parse their own args',
  'install-mcp': 'the installer parses its own args',
  diff: 'passes args through to git',
  log: 'passes args through to git',
  show: 'passes args through to git',
  pkg: 'passes args through to the package manager',
  json: 'passes args through to the JSON reader'
};

/** Flags every command accepts through the shared boot path. */
const GLOBAL_FLAGS = new Set(['--help', '--version', '--project-root', '--root', '--as']);

/** Help text for an exempt command, or null when its flags are checked. */
export const exemptionNote = (name) => {
  const reason = PASSTHROUGH_COMMANDS[name];
  return reason ? `Unknown flags are not checked for this command: ${reason}.` : null;
};

export const SHORT_FLAG_NOTE = 'Short flags (-x) are not checked for typos.';

const LONG_FLAG = /--[a-z][a-z0-9-]*/g;

const distance = (a, b) => {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
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
  const isChecked = Boolean(entry) && !Object.hasOwn(PASSTHROUGH_COMMANDS, entry.name);
  if (!isChecked) return null;
  const known = knownLongFlags(entry);
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
    const isLongFlag = arg.startsWith('--') && arg.length > 2;
    if (!isLongFlag) continue;
    const hasInlineValue = arg.includes('=');
    const name = hasInlineValue ? arg.slice(0, arg.indexOf('=')) : arg;
    const isAccepted = known.has(name) || GLOBAL_FLAGS.has(name);
    const consumesNext = known.get(name) === true && !hasInlineValue;
    if (consumesNext) i++;
    if (isAccepted) continue;
    const closest = suggestFlag(name, known.keys());
    const hint = closest ? `; did you mean ${closest}?` : '';
    return `chemx ${entry.name}: unknown flag ${name}${hint} Run \`chemx ${entry.name} --help\`.`;
  }
  return null;
};
