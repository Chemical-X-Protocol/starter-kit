// `chemx q -g --regex` answers the RE2 subset on both engines: ripgrep (Rust regex, linear time) and
// the JS fallback. RE2 has no lookaround and no backreferences, so both are refused on both engines
// and the answer never depends on whether `rg` is installed. The JS engine also backtracks, so a
// quantified group that holds a quantifier ((a+)+) could stall it: that one is refused there only.

const LOOKAROUND_OPENERS = ['(?=', '(?!', '(?<=', '(?<!'];
const COUNTED_REPEAT = /^\{\d+(,\d*)?\}/;

const REFUSALS = {
  lookaround: 'lookaround ((?=, (?!, (?<=, (?<!) is not supported in regex mode (RE2 subset)',
  backreference: 'a backreference (\\1, \\k<name>) is not supported in regex mode (RE2 subset)',
  nestedQuantifier: 'a nested quantifier (a quantified group that holds a quantifier, like (a+)+) is refused without ripgrep because the JS engine backtracks: install ripgrep or rewrite the pattern'
};

const skipClass = (pattern, start) => {
  let i = start + 1;
  const isNegated = pattern[i] === '^';
  if (isNegated) i += 1;
  while (i < pattern.length && pattern[i] !== ']') i += pattern[i] === '\\' ? 2 : 1;
  return i + 1;
};

const isBackreference = (pattern, i) => {
  const next = pattern[i + 1] ?? '';
  const isNumbered = next >= '1' && next <= '9';
  const isNamed = next === 'k' && pattern[i + 2] === '<';
  return isNumbered || isNamed;
};

const readQuantifierLength = (pattern, i) => {
  const ch = pattern[i];
  const isStarOrPlus = ch === '*' || ch === '+';
  if (isStarOrPlus) return 1;
  const counted = ch === '{' ? COUNTED_REPEAT.exec(pattern.slice(i)) : null;
  return counted ? counted[0].length : 0;
};

// What the pattern uses that the subset does not allow. Escapes and classes are skipped whole.
export const scanRegex = (pattern) => {
  const found = { lookaround: false, backreference: false, nestedQuantifier: false };
  const open = [];
  let lastClosed = null;
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    const quantifierLength = readQuantifierLength(pattern, i);
    const isQuantifier = quantifierLength > 0;
    if (ch === '\\') {
      if (isBackreference(pattern, i)) found.backreference = true;
      lastClosed = null;
      i += 2;
    } else if (ch === '[') {
      lastClosed = null;
      i = skipClass(pattern, i);
    } else if (ch === '(') {
      if (LOOKAROUND_OPENERS.some((opener) => pattern.startsWith(opener, i))) found.lookaround = true;
      open.push({ hasQuantifier: false });
      lastClosed = null;
      i += 1;
    } else if (ch === ')') {
      lastClosed = open.pop() ?? null;
      i += 1;
    } else if (isQuantifier) {
      if (lastClosed?.hasQuantifier) found.nestedQuantifier = true;
      for (const group of open) group.hasQuantifier = true;
      lastClosed = null;
      i += quantifierLength;
    } else {
      lastClosed = null;
      i += 1;
    }
  }
  return found;
};

export const assertRegexSupported = (pattern, { isBacktracking = false } = {}) => {
  const found = scanRegex(pattern);
  const refused = Object.keys(REFUSALS).find((key) => found[key] && (key !== 'nestedQuantifier' || isBacktracking));
  if (refused) throw new Error(`regex ${JSON.stringify(pattern)}: ${REFUSALS[refused]}`);
};

// Alternation, wildcards, classes, escapes and anchors: a fixed-string search that finds nothing for
// such a pattern was probably meant as a regex.
const REGEX_SHAPE = /\\\||\||\.\*|\.\+|\\[dwsbDWSB]|\[[^\]]+\]|^\^|\$$/;

export const looksLikeRegex = (pattern) => REGEX_SHAPE.test(pattern);
