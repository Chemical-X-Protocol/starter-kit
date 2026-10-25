/**
 * Chemical X Protocol: the changes `chemx mutate --apply` takes (#6762, K17). Text in, text out.
 * - A sed substitution, `[N[,M]]s<d>pattern<d>replacement<d>[gi]`, applied per line like sed does: the
 *   first match on each line (every match with g) of the whole file or of lines N..M. The pattern is a
 *   JavaScript regular expression; the replacement understands & (the match), \1..\9, \n, \t and \&.
 *   Any character that is not a letter, digit, backslash or space can be the delimiter; `\<d>` in the
 *   pattern is that character (kept escaped when it is a regex metacharacter, so `s|a\|b|X|` matches
 *   the text a|b).
 * - A unified diff for one file. Its file header lines are ignored (the file is the one named on the
 *   command line); every hunk must match exactly, found at most MAX_OFFSET lines from where it says.
 */

const MAX_OFFSET = 40;
const SED_START = /^(?:(\d+)(?:,(\d+))?)?s([^A-Za-z0-9\\\s])/;
const REGEX_META = new Set([...'^$.*+?()[]{}|\\']);
const SED_FLAGS = { g: 'g', i: 'i', I: 'i' };
const REPLACEMENT_ESCAPES = { n: '\n', t: '\t' };

/** Whether `value` looks like a sed substitution: an s command whose delimiter appears at least twice more. */
export const isSedExpression = (value) => {
  const start = SED_START.exec(String(value));
  if (!start) return false;
  const rest = String(value).slice(start[0].length);
  return rest.split(start[3]).length >= 3;
};

// Splits `text` at the next unescaped delimiter; returns [part, remainder] or null. Escapes stay as written.
const takeField = (text, delimiter) => {
  for (let at = 0; at < text.length; at += 1) {
    const isEscape = text[at] === '\\';
    if (isEscape) at += 1;
    const isDelimiter = !isEscape && text[at] === delimiter;
    if (isDelimiter) return [text.slice(0, at), text.slice(at + 1)];
  }
  return null;
};

const unescapeDelimiter = (field, delimiter, keepsMeta) => {
  const escaped = `\\${delimiter}`;
  const replacement = keepsMeta ? escaped : delimiter;
  return field.split(escaped).join(replacement);
};

const rangeOf = (start) => {
  const isAddressed = start[1] !== undefined;
  const hasRange = start[2] !== undefined;
  const from = isAddressed ? Number(start[1]) : 1;
  if (hasRange) return { from, to: Number(start[2]) };
  return { from, to: isAddressed ? from : Infinity };
};

const flagsOf = (expression, text) => [...text].map((flag) => {
  const isSupported = Object.hasOwn(SED_FLAGS, flag);
  if (!isSupported) throw new Error(`sed expression "${expression}": flag ${flag} is not supported (g and i are)`);
  return SED_FLAGS[flag];
});

// The three fields of `s<d>pattern<d>replacement<d>flags` after the address.
const fieldsOf = (expression, start) => {
  const delimiter = start[3];
  const pattern = takeField(expression.slice(start[0].length), delimiter);
  const replacement = pattern ? takeField(pattern[1], delimiter) : null;
  if (!replacement) throw new Error(`sed expression "${expression}" is unterminated: s${delimiter}pattern${delimiter}replacement${delimiter}[flags]`);
  return { delimiter, pattern: pattern[0], replacement: replacement[0], flags: replacement[1] };
};

const parseSed = (expression) => {
  const start = SED_START.exec(expression);
  if (!start) throw new Error(`"${expression}" is not a sed substitution (s/old/new/ with an optional line address)`);
  const fields = fieldsOf(expression, start);
  const isEmptyPattern = fields.pattern === '';
  if (isEmptyPattern) throw new Error(`sed expression "${expression}" has an empty pattern`);
  const flags = [...new Set(flagsOf(expression, fields.flags))].join('');
  const source = unescapeDelimiter(fields.pattern, fields.delimiter, REGEX_META.has(fields.delimiter));
  try {
    return { regex: new RegExp(source, flags), replacement: unescapeDelimiter(fields.replacement, fields.delimiter, false), ...rangeOf(start) };
  } catch (error) {
    throw new Error(`sed expression "${expression}": not a valid regular expression (${error.message})`);
  }
};

// Expands & and \1..\9 and the escapes in a sed replacement for one match.
const expandReplacement = (template, match, groups) => {
  let result = '';
  for (let at = 0; at < template.length; at += 1) {
    const char = template[at];
    const next = template[at + 1];
    const isEscape = char === '\\' && next !== undefined;
    const isGroup = isEscape && /[0-9]/.test(next);
    if (isGroup) result += next === '0' ? match : (groups[Number(next) - 1] ?? '');
    const isPlainEscape = isEscape && !isGroup;
    if (isPlainEscape) result += REPLACEMENT_ESCAPES[next] ?? next;
    if (isEscape) at += 1;
    if (!isEscape) result += char === '&' ? match : char;
  }
  return result;
};

export const applySed = (text, expression) => {
  const edit = parseSed(String(expression));
  return text.split('\n').map((line, index) => {
    const number = index + 1;
    const isInRange = number >= edit.from && number <= edit.to;
    if (!isInRange) return line;
    return line.replace(edit.regex, (match, ...rest) => {
      const captures = rest.slice(0, rest.findIndex((item) => typeof item === 'number'));
      return expandReplacement(edit.replacement, match, captures);
    });
  }).join('\n');
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NO_EOL = '\\';

// Reads one hunk's body by its line counts; returns the hunk and the index after it.
const readHunk = (lines, at, header) => {
  let oldLeft = header[2] === undefined ? 1 : Number(header[2]);
  let newLeft = header[4] === undefined ? 1 : Number(header[4]);
  const hunk = { oldStart: Number(header[1]), oldLines: [], newLines: [], oldNoEol: false, newNoEol: false };
  let previous = ' ';
  let index = at;
  for (; index < lines.length && (oldLeft > 0 || newLeft > 0 || lines[index][0] === NO_EOL); index += 1) {
    const line = lines[index];
    const kind = line[0];
    const isMarker = kind === NO_EOL;
    if (isMarker) {
      hunk.oldNoEol = hunk.oldNoEol || previous !== '+';
      hunk.newNoEol = hunk.newNoEol || previous !== '-';
      continue;
    }
    previous = kind;
    const isOld = kind === ' ' || kind === '-';
    const isNew = kind === ' ' || kind === '+';
    if (isOld) { hunk.oldLines.push(line.slice(1)); oldLeft -= 1; }
    if (isNew) { hunk.newLines.push(line.slice(1)); newLeft -= 1; }
  }
  return { hunk, next: index };
};

const parseHunks = (patch) => {
  const lines = patch.split('\n');
  const hasTrailingBlank = lines[lines.length - 1] === '';
  if (hasTrailingBlank) lines.pop();
  const hunks = [];
  for (let at = 0; at < lines.length; at += 1) {
    const header = HUNK_HEADER.exec(lines[at]);
    const startsAnotherFile = hunks.length > 0 && !header && /^diff --git /.test(lines[at]);
    if (startsAnotherFile) throw new Error('the patch touches more than one file; give mutate one file and its own patch');
    if (!header) continue;
    const read = readHunk(lines, at + 1, header);
    hunks.push(read.hunk);
    at = read.next - 1;
  }
  const hasNoHunks = hunks.length === 0;
  if (hasNoHunks) throw new Error('the patch has no hunks (@@ -a,b +c,d @@)');
  return hunks;
};

const sameLines = (lines, at, wanted) => wanted.every((line, offset) => lines[at + offset] === line);

// The index where the hunk's old lines match, nearest to `expected` first.
const locate = (lines, wanted, expected) => {
  for (let offset = 0; offset <= MAX_OFFSET; offset += 1) {
    for (const at of offset === 0 ? [expected] : [expected + offset, expected - offset]) {
      const fits = at >= 0 && at + wanted.length <= lines.length;
      const isMatch = fits && sameLines(lines, at, wanted);
      if (isMatch) return at;
    }
  }
  return -1;
};

export const applyUnifiedDiff = (text, patch) => {
  const hunks = parseHunks(String(patch));
  const hadEol = text.endsWith('\n');
  const lines = (hadEol ? text.slice(0, -1) : text).split('\n');
  let delta = 0;
  hunks.forEach((hunk, index) => {
    const expected = (hunk.oldLines.length === 0 ? hunk.oldStart : hunk.oldStart - 1) + delta;
    const at = locate(lines, hunk.oldLines, expected);
    const isFound = at >= 0;
    if (!isFound) throw new Error(`hunk ${index + 1} does not apply: its context is not within ${MAX_OFFSET} lines of line ${hunk.oldStart}`);
    lines.splice(at, hunk.oldLines.length, ...hunk.newLines);
    delta += hunk.newLines.length - hunk.oldLines.length;
  });
  const lostEol = hunks.some((hunk) => hunk.newNoEol);
  const gainedEol = hunks.some((hunk) => hunk.oldNoEol) && !lostEol;
  const hasEol = lostEol ? false : (gainedEol || hadEol);
  return lines.join('\n') + (hasEol ? '\n' : '');
};
