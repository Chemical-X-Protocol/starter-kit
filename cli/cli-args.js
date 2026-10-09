// Small schema-driven argv parser shared by test, typecheck and build.
// Every flag a command documents is declared here once; anything else is reported as unknown
// instead of being silently dropped. `--` ends option parsing and the rest is a command.

const splitInlineValue = (arg) => {
  const eqIndex = arg.indexOf('=');
  const hasInlineValue = arg.startsWith('-') && eqIndex > 0;
  return hasInlineValue ? [arg.slice(0, eqIndex), arg.slice(eqIndex + 1)] : [arg, null];
};

// schema: { booleans: { '--json': 'json' }, values: { '-t': 'filter', '--filter': 'filter' } }
// Returns { flags, values, positionals, command, unknown, missingValues }.
export const parseCliArgs = (rawArgs = [], schema = {}) => {
  const booleans = schema.booleans || {};
  const valueFlags = schema.values || {};
  const result = { flags: {}, values: {}, positionals: [], command: null, unknown: [], missingValues: [] };

  for (let index = 0; index < rawArgs.length; index++) {
    const arg = String(rawArgs[index]);
    const isCommandSeparator = arg === '--';
    if (isCommandSeparator) {
      const command = rawArgs.slice(index + 1).join(' ').trim();
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
      if (inlineValue === null && hasNextValue) index++;
      if (value === null) result.missingValues.push(name);
      else result.values[valueFlags[name]] = value;
      continue;
    }

    const isFlag = arg.startsWith('-') && arg.length > 1;
    if (isFlag) result.unknown.push(arg);
    else result.positionals.push(arg);
  }
  return result;
};

export const describeArgErrors = (parsed, commandName) => {
  const problems = [];
  if (parsed.unknown.length > 0) problems.push(`unknown flag(s) ${parsed.unknown.join(', ')}`);
  if (parsed.missingValues.length > 0) problems.push(`missing value for ${parsed.missingValues.join(', ')}`);
  if (problems.length === 0) return null;
  return `chemx ${commandName}: ${problems.join('; ')}. Run \`chemx ${commandName} --help\`.`;
};

// Seconds on the command line, milliseconds internally. Returns null when unset or invalid.
export const parseTimeoutSeconds = (value) => {
  const seconds = Number(value);
  const isUsable = value !== undefined && value !== null && Number.isFinite(seconds) && seconds > 0;
  return isUsable ? Math.round(seconds * 1000) : null;
};
