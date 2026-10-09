/**
 * Minimal flag-value reader shared by mutating CLI commands.
 * Accepts both `--name=value` and `--name value`, and reports which argv slots it consumed
 * so positional detection does not mistake a flag value for a file path.
 */

const FLAG_LIKE_REGEX = /^--?[A-Za-z]/;

/**
 * A spaced value that looks like a flag (`--content --overwrite`) is never taken as the value:
 * the value was forgotten, and swallowing the next flag would both write its text and drop it.
 * Values that start with '-' must use the inline form (`--content=--x`).
 *
 * @param {string[]} args argv slice.
 * @param {string[]} names Flag spellings, e.g. ['--content', '-c'].
 * @returns {{ value: string|undefined, consumed: number[] }}
 */
export const readFlagValue = (args, names) => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    for (const name of names) {
      const isInline = arg.startsWith(`${name}=`);
      if (isInline) return { value: arg.slice(name.length + 1), consumed: [i] };
      const isBare = arg === name;
      if (!isBare) continue;
      const next = args[i + 1];
      const hasValue = typeof next === 'string' && !FLAG_LIKE_REGEX.test(next);
      return hasValue ? { value: next, consumed: [i, i + 1] } : { value: undefined, consumed: [i] };
    }
  }
  return { value: undefined, consumed: [] };
};

/**
 * Reads several value flags at once and returns the remaining positionals.
 *
 * @param {string[]} args argv slice.
 * @param {Record<string, string[]>} spec { key: [spellings] }.
 * @returns {{ values: Record<string, string|undefined>, positionals: string[] }}
 */
export const parseValueFlags = (args, spec) => {
  const consumed = new Set();
  const values = {};
  for (const [key, names] of Object.entries(spec)) {
    const found = readFlagValue(args, names);
    values[key] = found.value;
    found.consumed.forEach((i) => consumed.add(i));
  }
  const positionals = args.filter((a, i) => !consumed.has(i) && !a.startsWith('-'));
  return { values, positionals };
};

export const hasFlag = (args, names) => names.some((n) => args.includes(n));

export const splitList = (value) => (value ? String(value).split(',').map((s) => s.trim()).filter(Boolean) : undefined);
