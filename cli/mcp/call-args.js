// Caller arguments that reach a shell or git verbatim: test target/filter and git wrapper options.
// detectTestCommand pastes target and filter into a shell string; git diff/log take raw options.

const SAFE_TEST_TARGET = /^[\w@%+=:,./*?[\]{}-]+$/;
// A target that starts with '-' is a runner option (`--import=data:...` runs code in every test process).
const isSafeTarget = (t) => typeof t === 'string' && SAFE_TEST_TARGET.test(t) && !t.startsWith('-');
// The filter is pasted inside double quotes: refuse the characters that still expand there.
const UNSAFE_IN_DOUBLE_QUOTES = /[$`"\\\n\r\0]/;
// git options that write a file or read one from outside the repository.
const GIT_FILE_OPTIONS = ['--output', '--no-index', '--ext-diff'];
const GIT_ACTIONS = new Set(['d', 'log']);
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

const checkGitArgs = (params) => {
  const args = params.args ?? [];
  const isStringList = Array.isArray(args) && args.every((a) => typeof a === 'string');
  if (!isStringList) return refuse('git wrapper args must be an array of strings.');
  const blocked = args.find(namesFileOption);
  const isBlocked = blocked !== undefined;
  if (isBlocked) return refuse(`Refusing git option "${blocked}" over MCP: it writes a file or reads one outside the repository.`);
  return { ok: true };
};

export const checkCallArgs = ({ action, params = {} }) => {
  const isTest = action === 'test';
  if (isTest) return checkTestArgs(params);
  const isGit = GIT_ACTIONS.has(action);
  if (isGit) return checkGitArgs(params);
  return { ok: true };
};
