/**
 * Chemical X Protocol: argument parsing for `chemx commit` (#2564).
 * Parsing only; it decides nothing. Anything it does not recognise is kept in `unknown` so the
 * validator can refuse it by name instead of passing it on to git.
 */

const VALUE_FLAGS = new Set(['-m', '--message', '--task', '--no-task', '--as']);
const KNOWN_FLAGS = new Set(['--release', '--json', '-a', '--all', '--no-verify', '-n']);

// Splits `--flag=value` into its name and value; a bare token has value undefined.
const splitToken = (token) => {
  const isLong = token.startsWith('--');
  const eqAt = token.indexOf('=');
  const hasInlineValue = isLong && eqAt > 0;
  return hasInlineValue ? { name: token.slice(0, eqAt), value: token.slice(eqAt + 1) } : { name: token, value: undefined };
};

const emptyParsed = () => ({
  files: [], messages: [], taskId: null, noTask: null, as: null,
  release: false, json: false, all: false, skipVerify: false, unknown: [], missingValue: []
});

const VALUE_SETTERS = {
  '-m': (parsed, value) => parsed.messages.push(value),
  '--message': (parsed, value) => parsed.messages.push(value),
  '--task': (parsed, value) => { parsed.taskId = String(value).replace(/^#/, ''); },
  '--no-task': (parsed, value) => { parsed.noTask = value; },
  '--as': (parsed, value) => { parsed.as = value; }
};

const BOOLEAN_SETTERS = {
  '--release': (parsed) => { parsed.release = true; },
  '--json': (parsed) => { parsed.json = true; },
  '-a': (parsed) => { parsed.all = true; },
  '--all': (parsed) => { parsed.all = true; },
  '--no-verify': (parsed) => { parsed.skipVerify = true; },
  '-n': (parsed) => { parsed.skipVerify = true; }
};

const applyValueFlag = (parsed, name, value) => VALUE_SETTERS[name](parsed, value);
const applyBooleanFlag = (parsed, name) => BOOLEAN_SETTERS[name](parsed);

/**
 * @param {string[]} args Everything after `chemx commit`.
 * @returns {{ files: string[], messages: string[], taskId: string|null, noTask: string|null, as: string|null,
 *   release: boolean, json: boolean, all: boolean, skipVerify: boolean, unknown: string[], missingValue: string[] }}
 */
export const parseCommitArgs = (args = []) => {
  const parsed = emptyParsed();
  for (let index = 0; index < args.length; index++) {
    const { name, value: inlineValue } = splitToken(args[index]);
    const isValueFlag = VALUE_FLAGS.has(name);
    const nextToken = args[index + 1];
    const takesNext = isValueFlag && inlineValue === undefined && nextToken !== undefined;
    const value = takesNext ? nextToken : inlineValue;
    if (takesNext) index += 1;
    const isMissing = isValueFlag && value === undefined;
    const isBoolean = KNOWN_FLAGS.has(name);
    const isFlagLike = name.startsWith('-') && name !== '-';
    const isUnrecognised = isFlagLike && !isValueFlag && !isBoolean;
    const isValueGiven = isValueFlag && !isMissing;
    const isPlainFile = !isFlagLike;
    const routes = [
      [isMissing, () => parsed.missingValue.push(name)],
      [isValueGiven, () => applyValueFlag(parsed, name, value)],
      [isBoolean, () => applyBooleanFlag(parsed, name)],
      [isUnrecognised, () => parsed.unknown.push(name)],
      [isPlainFile, () => parsed.files.push(name)]
    ];
    routes.filter(([applies]) => applies).forEach(([, run]) => run());
  }
  return parsed;
};
