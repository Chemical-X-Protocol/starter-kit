/**
 * Minimal flag-value reader shared by mutating CLI commands (re-exported by cli-args.js).
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

const PREVIEW_FLAG_REGEX = /^(?:-n|--?dry[-_]?run(?:=.*)?)$/i;

/**
 * One rule for "preview" across every mutating CLI command and the MCP command string:
 * `-n` or any dry-run spelling (`--dry-run`, `--dryRun`, `--dry_run`, `--dryrun`), with any value.
 * `--dry-run=false` also previews: to write, leave the flag out.
 *
 * @param {string} arg One argv token.
 * @returns {boolean}
 */
export const isPreviewFlag = (arg) => typeof arg === 'string' && PREVIEW_FLAG_REGEX.test(arg);

export const hasPreviewFlag = (args) => args.some(isPreviewFlag);

const GLOBAL_FLAGS = ['--json', '--help', '-h', '--yes', '-y', '--ci', '--headless', '--non-interactive', '--no-interactive', '--dev', '--no-color'];

/**
 * Flags a mutating command does not understand. A typo such as `--preview` must refuse, not write.
 *
 * @param {string[]} args argv slice.
 * @param {string[]} known Flag names the command reads (without `=value`).
 * @returns {string[]} The unknown flag tokens, as given.
 */
export const findUnknownFlags = (args, known) => {
  const allowed = new Set([...GLOBAL_FLAGS, ...known]);
  const isUnknown = (arg) => {
    const isFlag = FLAG_LIKE_REGEX.test(arg);
    const isAllowed = isPreviewFlag(arg) || allowed.has(arg.split('=')[0]);
    return isFlag && !isAllowed;
  };
  return args.filter(isUnknown);
};

/**
 * @param {string} command Command name for the message.
 * @param {string[]} unknown Result of findUnknownFlags.
 * @returns {string}
 */
export const unknownFlagsMessage = (command, unknown) =>
  `Unknown flag(s) for chemx ${command}: ${unknown.join(', ')}. Nothing was changed (preview with --dry-run; see chemx ${command} --help).`;

export const splitList = (value) => (value ? String(value).split(',').map((s) => s.trim()).filter(Boolean) : undefined);
