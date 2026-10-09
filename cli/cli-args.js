// Small schema-driven argv parser shared by test, typecheck and build.
// Every flag a command documents is declared here once; anything else is reported as unknown
// instead of being silently dropped. `--` ends option parsing and the rest is a command.
import { shellQuote } from './test-paths.js';

// Mutating commands (patch, write, explode, fix, add:*) read their flags with the helpers in
// mutation-args.js; they are re-exported so every caller imports argv helpers from one place.
export * from './mutation-args.js';

// Words the shell already split are re-quoted one by one to reach `sh -c` unchanged. The first
// word stays verbatim when it is the only word or contains whitespace: that is a whole shell
// command the user quoted (`chemx build "vite build"`, `-- "npm run build" --mode=x`).
export const joinCommandWords = (words = []) => {
  const [head = '', ...rest] = words.map(String);
  const isHeadCommandString = rest.length === 0 || /\s/.test(head);
  const headText = isHeadCommandString ? head : shellQuote(head);
  return [headText, ...rest.map(shellQuote)].join(' ').trim();
};

const splitInlineValue = (arg) => {
  const eqIndex = arg.indexOf('=');
  const hasInlineValue = arg.startsWith('-') && eqIndex > 0;
  return hasInlineValue ? [arg.slice(0, eqIndex), arg.slice(eqIndex + 1)] : [arg, null];
};

// schema: { booleans: { '--json': 'json' }, values: { '-t': 'filter', '--filter': 'filter' } }
// With schema.positionalCommand, the first positional starts the user's command and every word
// after it belongs to that command (`chemx wrap node --help`), chemx's own flags included.
// Returns { flags, values, positionals, command, unknown, missingValues }.
export const parseCliArgs = (rawArgs = [], schema = {}) => {
  const booleans = schema.booleans || {};
  const valueFlags = schema.values || {};
  const result = { flags: {}, values: {}, positionals: [], command: null, unknown: [], missingValues: [] };

  for (let index = 0; index < rawArgs.length; index++) {
    const arg = String(rawArgs[index]);
    const isCommandSeparator = arg === '--';
    if (isCommandSeparator) {
      const command = joinCommandWords(rawArgs.slice(index + 1));
      result.command = command.length > 0 ? command : null;
      break;
    }

    const [name, inlineValue] = splitInlineValue(arg);
    const isBoolean = Object.hasOwn(booleans, name) && inlineValue === null;
    if (isBoolean) {
      result.flags[booleans[name]] = true;
      continue;
    }

    const isValueFlag = Object.hasOwn(valueFlags, name);
    if (isValueFlag) {
      const nextArg = rawArgs[index + 1];
      const hasNextValue = nextArg !== undefined && nextArg !== '--';
      const value = inlineValue ?? (hasNextValue ? String(nextArg) : null);
      const consumesNextArg = inlineValue === null && hasNextValue;
      if (consumesNextArg) index++;
      const isMissingValue = value === null;
      if (isMissingValue) result.missingValues.push(name);
      else result.values[valueFlags[name]] = value;
      continue;
    }

    const isFlag = arg.startsWith('-') && arg.length > 1;
    if (isFlag) {
      result.unknown.push(arg);
      continue;
    }
    const startsCommand = Boolean(schema.positionalCommand);
    if (startsCommand) {
      result.positionals = rawArgs.slice(index).map(String);
      break;
    }
    result.positionals.push(arg);
  }
  return result;
};

// options.strayHint: this command takes no positional arguments; any is reported with the hint.
export const describeArgErrors = (parsed, commandName, options = {}) => {
  const problems = [];
  const hasUnknown = parsed.unknown.length > 0;
  if (hasUnknown) problems.push(`unknown flag(s) ${parsed.unknown.join(', ')}`);
  const hasMissingValues = parsed.missingValues.length > 0;
  if (hasMissingValues) problems.push(`missing value for ${parsed.missingValues.join(', ')}`);
  const hasStrayPositionals = Boolean(options.strayHint) && parsed.positionals.length > 0;
  if (hasStrayPositionals) problems.push(`unexpected argument(s) ${parsed.positionals.join(' ')}; ${options.strayHint}`);
  const timeoutValue = parsed.values.timeout;
  const hasInvalidTimeout = timeoutValue !== undefined && parseTimeoutSeconds(timeoutValue) === null;
  if (hasInvalidTimeout) problems.push(`invalid --timeout value "${timeoutValue}" (expected seconds from ${MIN_TIMEOUT_MS / 1000} to ${Math.floor(MAX_TIMEOUT_MS / 1000)})`);
  const isValid = problems.length === 0;
  if (isValid) return null;
  return `chemx ${commandName}: ${problems.join('; ')}. Run \`chemx ${commandName} --help\`.`;
};

// setTimeout fires after 1ms for delays above 2^31-1 ms, and a 0ms delay would mean no timeout.
const MIN_TIMEOUT_MS = 1;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

// Seconds on the command line, milliseconds internally. Returns null when unset or invalid.
export const parseTimeoutSeconds = (value) => {
  const seconds = Number(value);
  const isNumber = value !== undefined && value !== null && String(value).trim() !== '' && Number.isFinite(seconds);
  const milliseconds = Math.round(seconds * 1000);
  const isInRange = milliseconds >= MIN_TIMEOUT_MS && milliseconds <= MAX_TIMEOUT_MS;
  return isNumber && isInRange ? milliseconds : null;
};
