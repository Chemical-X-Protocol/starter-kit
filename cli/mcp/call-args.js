// Caller arguments that reach a shell or git verbatim: test target/filter and git wrapper options.
// detectTestCommand pastes target and filter into a shell string; git diff/log take raw options.
import { resolveInsideRoot } from './context.js';

const SAFE_TEST_TARGET = /^[\w@%+=:,./*?[\]{}-]+$/;
// A target that starts with '-' is a runner option (`--import=data:...` runs code in every test process).
const isSafeTarget = (t) => typeof t === 'string' && SAFE_TEST_TARGET.test(t) && !t.startsWith('-');
// The filter is pasted inside double quotes: refuse the characters that still expand there.
const UNSAFE_IN_DOUBLE_QUOTES = /[$`"\\\n\r\0]/;
// git options that write a file or read one from outside the repository.
const GIT_FILE_OPTIONS = ['--output', '--no-index', '--ext-diff'];
const GIT_ACTIONS = new Set(['d', 'log', 'show']);
const MIN_ABBREVIATION = 3;

const refuse = (error) => ({ ok: false, error });

const checkTestArgs = (params) => {
  const targets = [params.testTarget, params.target].filter((t) => t !== undefined && t !== null);
  const badTarget = targets.find((t) => !isSafeTarget(t));
  const hasBadTarget = badTarget !== undefined;
  if (hasBadTarget) return refuse(`Refusing test target ${JSON.stringify(badTarget)}: use one path or glob without spaces, shell syntax or a leading '-'.`);
  const hasFilter = params.filter !== undefined && params.filter !== null;
  const isBadFilter = hasFilter && (typeof params.filter !== 'string' || UNSAFE_IN_DOUBLE_QUOTES.test(params.filter));
  if (isBadFilter) return refuse(`Refusing test filter ${JSON.stringify(params.filter)}: it may not contain $, backticks, quotes, backslashes or newlines.`);
  return { ok: true };
};

// git accepts unambiguous long-option abbreviations, so `--outp=x` is `--output=x`.
const namesFileOption = (arg) => {
  const isLongOption = arg.startsWith('--') && arg.length > 2;
  if (!isLongOption) return false;
  const name = arg.split('=')[0];
  const isLongEnough = name.length >= MIN_ABBREVIATION;
  return isLongEnough && GIT_FILE_OPTIONS.some((option) => option.startsWith(name));
};

// Every non-option word (and every pathspec after `--`) is a ref or a path. git turns `d a b` into
// --no-index when a path is outside the work tree, and `rev:path` / `:/` name repo files outside a
// subdir root, so each word must resolve inside the root and may not contain ':' (refs never do).
const gitWords = (args) => {
  const separator = args.indexOf('--');
  const hasSeparator = separator !== -1;
  const before = hasSeparator ? args.slice(0, separator) : args;
  const pathspecs = hasSeparator ? args.slice(separator + 1) : [];
  return [...before.filter((a) => !a.startsWith('-')), ...pathspecs];
};

const findGitEscape = (args, root) => {
  const words = gitWords(args);
  const colon = words.find((word) => word.includes(':'));
  const hasColon = colon !== undefined;
  if (hasColon) return `Refusing git argument "${colon}" over MCP: rev:path and pathspec magic can name files outside the project root; pass option values as --opt=value.`;
  const escape = words.map((word) => resolveInsideRoot(root, word)).find(({ isInside }) => !isInside);
  const hasEscape = escape !== undefined;
  return hasEscape ? `Refusing git argument "${escape.requested}": it resolves to "${escape.resolved}", outside project root "${root}".` : null;
};

const checkGitArgs = (params, root) => {
  const args = params.args ?? [];
  const isStringList = Array.isArray(args) && args.every((a) => typeof a === 'string');
  if (!isStringList) return refuse('git wrapper args must be an array of strings.');
  const blocked = args.find(namesFileOption);
  const isBlocked = blocked !== undefined;
  if (isBlocked) return refuse(`Refusing git option "${blocked}" over MCP: it writes a file or reads one outside the repository.`);
  const escape = root ? findGitEscape(args, root) : null;
  return escape ? refuse(escape) : { ok: true };
};

export const checkCallArgs = ({ action, params = {} }, root = null) => {
  const isTest = action === 'test';
  if (isTest) return checkTestArgs(params);
  const isGit = GIT_ACTIONS.has(action);
  if (isGit) return checkGitArgs(params, root);
  return { ok: true };
};
