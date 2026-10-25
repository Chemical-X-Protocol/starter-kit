// Argument shapes the guard branches on to decide whether chemx covers a call: git scripting flags,
// grep flag letters, revision ranges, sleep durations. Pure functions over word lists.

import { fileOperands, optionValue, stdoutWrites } from './guard-args.js';

export const DIFF_SCRIPTING_FLAGS = /^--(?:quiet|exit-code|name-only|name-status|numstat|check|raw)$/;
export const LOG_SCRIPTING_FLAGS = /^--(?:format|pretty=(?:format|tformat):)|^--pretty=format|^--format=/;
export const SHOW_SCRIPTING_FLAGS = /^(?:--(?:format|pretty)(?:=.*)?|--name-only|--name-status|--no-patch|--quiet|-s)$/;
export const NAME_LIST_FLAGS = new Set(['--name-only', '--name-status']);

const FLAG_CLUSTER = /^-[A-Za-z]+$/;
// grep long flags and the short letter each stands for.
const GREP_LONG_FLAGS = {
  count: 'c', 'only-matching': 'o', 'invert-match': 'v', 'word-regexp': 'w', 'line-regexp': 'x', 'files-without-match': 'L',
  quiet: 'q', silent: 'q', 'perl-regexp': 'P', 'null-data': 'z', 'byte-offset': 'b', 'ignore-case': 'i', 'files-with-matches': 'l'
};
// Filters grep applies that `chemx q -g` has no flag for: nothing to point at, so no deny.
export const GREP_UNCOVERED_LETTERS = ['v', 'w', 'x', 'L', 'q', 'P', 'z', 'b'];
const REGEX_METACHARACTERS = /[.*+?^$()[\]{}|\\]/;
const SECONDS = { '': 1, s: 1, m: 60, h: 3600, d: 86400 };
const SLEEP_AMOUNT = /^(\d+(?:\.\d+)?)([smhd]?)$/;
const GIT_LIMIT_FLAGS = /^(?:-n\d*|--max-count(?:=\d+)?|-\d+)$/;
const SHOW_COVERED_FLAGS = new Set(['-p', '--patch', '--stat', '--full']);

const GREP_VALUE_FLAGS = new Set(['-e', '-f', '-m', '-A', '-B', '-C', '--regexp', '--file', '--max-count', '--include', '--exclude', '--exclude-dir', '--context', '--after-context', '--before-context']);

/** The pattern and file operands of a grep command line. A grep with no file operand filters stdin. */
export const grepParts = ({ args }) => {
  const operands = fileOperands(args, GREP_VALUE_FLAGS);
  const patternFlag = optionValue(args, ['-e', '--regexp']);
  const hasPatternFlag = patternFlag !== null;
  return hasPatternFlag ? { pattern: patternFlag, files: operands } : { pattern: operands[0] ?? '<text>', files: operands.slice(1) };
};

/** True when another command shares this command's pipeline, so its output is read by a pipe. */
export const feedsPipe = (parsed, siblings) => siblings.some((other) => other !== parsed && other.depth === parsed.depth && other.pipeline === parsed.pipeline);

/** True when the command's output is consumed (pipe, substitution, redirect) instead of shown. */
export const isOutputConsumed = (parsed, siblings) => parsed.depth > 0 || feedsPipe(parsed, siblings) || stdoutWrites(parsed).length > 0;

/** Words for a printed chemx call: quoted when they hold whitespace. */
export const shellWords = (words) => words.map((word) => (/\s/.test(word) ? `"${word}"` : word)).join(' ');

const beforeSeparator = (args) => {
  const separator = args.indexOf('--');
  return separator === -1 ? args : args.slice(0, separator);
};

/** Short letters of every flag cluster (`-rno` -> r, n, o) plus the letters long grep flags stand for. */
export const grepLetters = (args) => {
  const letters = new Set(args.filter((arg) => FLAG_CLUSTER.test(arg)).flatMap((arg) => arg.slice(1).split('')));
  for (const arg of args) {
    const isLong = arg.startsWith('--');
    const letter = isLong ? GREP_LONG_FLAGS[arg.slice(2).split('=')[0]] : undefined;
    if (letter) letters.add(letter);
  }
  return letters;
};

/** True when the grep filters in a way `chemx q -g` cannot express (invert, whole word, quiet...). */
export const hasUncoveredGrepFlag = (letters) => GREP_UNCOVERED_LETTERS.some((letter) => letters.has(letter));

/** The `chemx q -g` flags that carry a grep shape over: -i, -l, and --regex for a pattern with metacharacters. */
export const qFlagsFor = (letters, pattern) => {
  const needsRegex = letters.has('E') || letters.has('P') || REGEX_METACHARACTERS.test(pattern);
  const flags = [letters.has('i') ? '--ignore-case' : null, letters.has('l') ? '-l' : null, needsRegex ? '--regex' : null];
  return flags.filter(Boolean);
};

/** A git revision range word: `A..B` or `A...B` (not a `../path` and not a flag). */
export const isRevisionRange = (word) => {
  const isFlag = word.startsWith('-');
  const isRelativePath = word.startsWith('../') || word.startsWith('./') || word === '..';
  return !isFlag && !isRelativePath && /\.\.\.?/.test(word);
};

export const revisionRangesIn = (args) => beforeSeparator(args).filter(isRevisionRange);

/** True when the git log args already cap the commit count (-n N, -N, --max-count). */
export const hasCommitLimit = (args) => args.some((arg) => GIT_LIMIT_FLAGS.test(arg));

/** Seconds a `sleep` operand stands for (`30`, `2m`, `1.5`), null when it is a variable or unreadable. */
export const sleepSeconds = (args) => {
  const operand = fileOperands(args, new Set())[0] ?? '';
  const found = SLEEP_AMOUNT.exec(operand);
  return found ? Number(found[1]) * SECONDS[found[2]] : null;
};

/** What `git show` was asked for: its non-flag words before `--`, its flags, and its pathspecs. */
export const showShape = (rest) => {
  const separator = rest.indexOf('--');
  const head = separator === -1 ? rest : rest.slice(0, separator);
  const operands = fileOperands(head, new Set());
  const flags = head.filter((arg) => arg.startsWith('-'));
  const paths = separator === -1 ? [] : rest.slice(separator + 1);
  return { operands, flags, paths };
};

/** chemx show takes one revision, optional -p/--patch/--stat/--full, and pathspecs; chemx read takes one rev:path. */
export const isShowCovered = (rest) => {
  const { operands, flags } = showShape(rest);
  const hasOnlyCoveredFlags = flags.every((flag) => SHOW_COVERED_FLAGS.has(flag));
  return operands.length <= 1 && hasOnlyCoveredFlags;
};
