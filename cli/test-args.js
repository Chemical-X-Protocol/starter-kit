// Argument repairs for `chemx test`, for the two ways a shell hands over words the user meant
// differently: an unquoted test name (`-t should do x` arrives as three words) and a list of paths
// in one quoted string (`"a.spec.js b.spec.js"`, which zsh does not split from a variable). What
// cannot be repaired is named by args-unsplit-hint.js in the "matched nothing" line (#6773).
import fs from 'node:fs';
import path from 'node:path';
import { SPEC_FILE } from './test-select.js';

const FILTER_FLAG = /^(?:-t|--filter|--test-name-pattern)(?:=(.*))?$/;
const GLOB_CHARS = /[*?[{]/;

// A word that is a path or a glob on its own: it exists, has a glob character, or is named like a spec.
const isTargetWord = (word, cwd) => GLOB_CHARS.test(word) || SPEC_FILE.test(word) || fs.existsSync(path.resolve(cwd, word));
const isFlagWord = (word) => word.startsWith('-');

// `-t a b c` becomes `-t "a b c"`: the words after a name filter that are not paths, globs or spec
// files are the rest of the name. Paths and globs among them stay targets, after the filter.
// Everything up to the next flag or `--` is considered; the arguments are otherwise untouched.
export const foldFilterWords = (args, cwd = process.cwd()) => {
  const out = [];
  const targets = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const match = FILTER_FLAG.exec(arg);
    if (!match) {
      out.push(arg);
      continue;
    }
    const inline = match[1];
    const hasInline = inline !== undefined;
    const next = args[index + 1];
    const hasSpacedValue = !hasInline && next !== undefined && !isFlagWord(next);
    const words = hasInline ? [inline] : [];
    if (hasSpacedValue) {
      words.push(next);
      index++;
    }
    while (args[index + 1] !== undefined && !isFlagWord(args[index + 1])) {
      const word = args[++index];
      (isTargetWord(word, cwd) ? targets : words).push(word);
    }
    const flag = arg.split('=')[0];
    const hasName = words.length > 0;
    out.push(...(hasName ? [flag, words.join(' ')] : [arg]), ...targets.splice(0));
  }
  return out;
};

// One argument holding several paths ("a.spec.js b.spec.js", a shell variable that was not split)
// becomes one argument per path, when the whole string is not a path and every word is.
export const splitQuotedPaths = (args, cwd = process.cwd()) => args.flatMap((arg) => {
  const words = arg.split(/\s+/).filter(Boolean);
  const hasSeveralWords = !isFlagWord(arg) && words.length > 1;
  const isWholePath = fs.existsSync(path.resolve(cwd, arg));
  const areAllPaths = hasSeveralWords && !isWholePath && words.every((word) => isTargetWord(word, cwd));
  return areAllPaths ? words : [arg];
});

export const repairTestArgs = (args, cwd = process.cwd()) => splitQuotedPaths(foldFilterWords(args, cwd), cwd);
