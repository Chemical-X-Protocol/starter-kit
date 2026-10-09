// argv for `chemx q`. Value flags consume their value (so `-n 5` never becomes the query),
// `--` ends options, and the token right after -g/--literal is the pattern even when it
// starts with a dash (`q -g --x-glass`). Unknown flags are reported, never silently dropped.

const VALUE_FLAGS = new Map([
  ['-n', 'limit'], ['--limit', 'limit'], ['--dir', 'dir'], ['--tier', 'tier'],
  ['--max-depth', 'maxDepth'], ['--rule', 'rule'], ['-d', 'maxDepth']
]);

const BOOLEAN_FLAGS = new Set([
  '--json', '-j', '--raw-json', '--no-columnar', '--columnar', '-g', '--literal', '-i', '--inspect',
  '-l', '--lines', '--include-internal', '--reindex', '--blast-radius', '--blast', '--impact',
  '--trace', '--backtrace', '--semantic', '--hybrid', '--critical', '--progression', '--failing',
  '--degraded', '--crystalline', '--clean', '--regex', '-F', '--fixed-strings', '--hidden',
  '--full', '--help', '-h', '--ignore-case'
]);

const LITERAL_FLAGS = new Set(['-g', '--literal']);
const INTEGER_KEYS = new Set(['limit', 'maxDepth']);

const isKnownFlag = (token) => {
  const name = token.split('=')[0];
  return BOOLEAN_FLAGS.has(name) || VALUE_FLAGS.has(name);
};

const isFlagLike = (token) => token.length > 1 && token.startsWith('-');

// A following `--` or known flag is never a value: `--dir -g foo` leaves --dir without one.
const readSeparateValue = (next) => {
  const isAbsent = next === undefined;
  if (isAbsent) return undefined;
  const isOption = String(next) === '--' || isKnownFlag(String(next));
  return isOption ? undefined : next;
};

const isPositiveInteger = (raw) => /^\d+$/.test(raw) && Number(raw) > 0;

export const parseSearchArgs = (rawArgs = []) => {
  const parsed = { positionals: [], flags: new Set(), values: {}, unknownFlags: [], missingValues: [], invalidValues: [], pattern: null };
  let isOptionsEnded = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const token = String(rawArgs[i]);
    if (isOptionsEnded) {
      parsed.positionals.push(token);
      continue;
    }
    if (token === '--') {
      isOptionsEnded = true;
      continue;
    }
    const isFlag = isFlagLike(token);
    if (!isFlag) {
      parsed.positionals.push(token);
      continue;
    }
    const [name, ...rest] = token.split('=');
    const hasInlineValue = rest.length > 0;
    const valueKey = VALUE_FLAGS.get(name);
    if (valueKey) {
      const value = hasInlineValue ? rest.join('=') : readSeparateValue(rawArgs[i + 1]);
      const hasValue = value !== undefined;
      if (!hasValue) parsed.missingValues.push(name);
      if (!hasInlineValue && hasValue) i += 1;
      if (hasValue) parsed.values[valueKey] = String(value);
      const isBadInteger = hasValue && INTEGER_KEYS.has(valueKey) && !isPositiveInteger(String(value));
      if (isBadInteger) parsed.invalidValues.push(`${name} ${value} (expected a positive integer)`);
      continue;
    }
    const isBoolean = BOOLEAN_FLAGS.has(name);
    if (!isBoolean) {
      parsed.unknownFlags.push(token);
      continue;
    }
    parsed.flags.add(name);
    const isLiteralFlag = LITERAL_FLAGS.has(name);
    const next = rawArgs[i + 1];
    const hasPatternToken = isLiteralFlag && next !== undefined && next !== '--' && !isKnownFlag(String(next));
    if (hasPatternToken) {
      parsed.pattern = String(next);
      i += 1;
    }
  }
  return parsed;
};

export const hasAnyFlag = (parsed, names) => names.some((name) => parsed.flags.has(name));

export const readIntValue = (parsed, key, fallback) => {
  const raw = parsed.values[key];
  const value = Number.parseInt(raw, 10);
  const isValid = Number.isFinite(value) && value > 0;
  return isValid ? value : fallback;
};
