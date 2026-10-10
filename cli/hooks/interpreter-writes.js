// Files an inline interpreter script writes (#4585): the shared detector behind the guard rule
// shell-interpreter-write and the audit-run bypass count. Limits: it reads the script text with
// regular expressions, so it sees only literal targets and same-script `name = 'literal'` variables;
// a computed target is reported as unresolved, never guessed. Only scripts passed inline are seen
// (heredoc body, -c / -e / --eval, a herestring, or a script file whose body the caller supplies).

const INTERPRETERS = [
  [/^python(?:\d+(?:\.\d+)*)?$/, 'python'],
  [/^(?:node|nodejs|deno|bun)$/, 'js'],
  [/^ruby$/, 'ruby'],
  [/^perl$/, 'perl'],
];
const WRAPPERS = new Set(['env', 'command', 'exec', 'nohup', 'sudo', 'time']);
const ASSIGNMENT_WORD = /^[A-Za-z_]\w*=/;
const INLINE_FLAGS = {
  python: /^(?:-c|-[A-Za-z]*c)$/,
  js: /^(?:-e|-p|-pe|-ep|--eval|--print)$/,
  ruby: /^(?:-e|-[A-Za-z]*e)$/,
  perl: /^(?:-e|-E|-[A-Za-z]*[eE])$/,
};
const ASSIGNMENT = /(?:^|[\s;(,])(?:(?:const|let|var|my|our)\s+)?([$@]?[A-Za-z_][\w$]*)\s*=(?!=)\s*([^;\n]+)/g;
const LITERAL = /^(['"`])([^'"`\\]*)\1$/;
const MAX_DEPTH = 4;

const baseName = (word) => String(word ?? '').split('/').pop();

// { family, args } of the interpreter this command runs, or null.
const interpreterOf = (argv) => {
  let rest = [...argv];
  while (rest.length > 0 && (WRAPPERS.has(baseName(rest[0])) || ASSIGNMENT_WORD.test(rest[0]))) rest = rest.slice(1);
  const head = baseName(rest[0]);
  const found = INTERPRETERS.find(([pattern]) => pattern.test(head));
  return found ? { family: found[1], args: rest.slice(1) } : null;
};

// Script texts of one command: -c/-e values, heredoc bodies, herestrings, and the body of a script file argument.
const scriptsOf = ({ family, args }, redirects, files) => {
  const isFlagWithValue = (arg, index) => INLINE_FLAGS[family].test(arg) && args[index + 1] !== undefined;
  const inline = args.flatMap((arg, index) => (isFlagWithValue(arg, index) ? [String(args[index + 1])] : []));
  const fromFiles = args.filter((arg) => Object.hasOwn(files, arg)).map((arg) => files[arg]);
  const bodies = (redirects ?? []).filter((redirect) => typeof redirect.body === 'string').map((redirect) => redirect.body);
  const isHerestring = (redirect) => redirect.op === '<<<' && typeof redirect.target === 'string';
  const herestrings = (redirects ?? []).filter(isHerestring).map((redirect) => redirect.target);
  return [...inline, ...fromFiles, ...bodies, ...herestrings];
};

const OPENERS = '([{';
const CLOSERS = ')]}';
const isQuoteChar = (ch) => ch === '"' || ch === "'" || ch === '`';

// One character of a call's argument list: updates the scan state { depth, quote, current, args, done }.
const scanQuoted = (state, source, index) => {
  const ch = source[index];
  const isEscape = ch === '\\';
  state.current += isEscape ? ch + (source[index + 1] ?? '') : ch;
  state.quote = ch === state.quote ? null : state.quote;
  return isEscape ? index + 1 : index;
};

const scanPlain = (state, ch) => {
  const isTopLevel = state.depth === 0;
  const isClose = CLOSERS.includes(ch);
  const isEnd = isClose && isTopLevel;
  const isSplit = ch === ',' && isTopLevel;
  const isBoundary = isEnd || isSplit;
  if (isBoundary) state.args.push(state.current.trim());
  state.done = isEnd;
  state.current = isBoundary ? '' : state.current + ch;
  state.quote = isQuoteChar(ch) ? ch : null;
  state.depth += (OPENERS.includes(ch) ? 1 : 0) - (isClose && !isTopLevel ? 1 : 0);
};

const scanCallChar = (state, source, index) => {
  const isInQuote = state.quote !== null;
  if (isInQuote) return scanQuoted(state, source, index);
  scanPlain(state, source[index]);
  return index;
};

// Arguments of the call whose "(" sits at `open`, split at top-level commas.
const callArgs = (source, open) => {
  const state = { depth: 0, quote: null, current: '', args: [], done: false };
  for (let index = open + 1; index < source.length && !state.done; index += 1) index = scanCallChar(state, source, index);
  return state.done ? state.args : [...state.args, state.current.trim()];
};

const variablesOf = (source) => {
  const vars = {};
  for (const [, name, value] of source.matchAll(ASSIGNMENT)) vars[name] = value.trim();
  return vars;
};

// The literal path an expression stands for, or null: 'x', Path('x'), a variable holding either.
const resolveExpression = (expression, vars, depth = 0) => {
  const text = String(expression ?? '').trim();
  const literal = text.match(LITERAL);
  const wrapped = text.match(/^(?:pathlib\.)?Path\((.*)\)$/s);
  const isDeep = depth >= MAX_DEPTH;
  const isName = /^[$@]?[A-Za-z_][\w$]*$/.test(text) && Object.hasOwn(vars, text);
  const isInterpolated = literal !== null && literal[1] === '`' && text.includes('${');
  const inner = wrapped ? callArgs(`(${wrapped[1]})`, 0)[0] : null;
  const next = isName ? vars[text] : inner;
  const isFollowable = !isDeep && next !== null;
  const followed = isFollowable ? resolveExpression(next, vars, depth + 1) : null;
  const literalValue = isInterpolated ? null : literal?.[2];
  return literal ? literalValue : followed;
};

const isWriteMode = (mode, vars) => {
  const resolved = resolveExpression(mode, vars);
  return resolved !== null && /^[rbtU]*[wax]|\+/.test(resolved);
};
const modeOf = (args) => args.slice(1).find((arg) => /^mode\s*=/.test(arg))?.replace(/^mode\s*=\s*/, '') ?? args[1];

// Each table row: [call regex, (args, vars) => path expressions written]. The regex ends on the "(" of the call.
const PYTHON = [
  [/(?<![\w.])(?:io\.)?open\s*\(/g, (args, vars) => (isWriteMode(modeOf(args), vars) ? [args[0]] : [])],
  [/\bshutil\.(?:copy|copy2|copyfile|copytree)\s*\(/g, (args) => [args[1]]],
  [/\b(?:shutil\.move|os\.(?:replace|rename))\s*\(/g, (args) => [args[0], args[1]]],
];
const PYTHON_METHODS = /(Path\([^()]*\)|[$@]?[A-Za-z_][\w$]*)\.(?:write_text|write_bytes)\s*\(/g;
const JS = [
  [/\b(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|rmSync|rm)\s*\(/g, (args) => [args[0]]],
  [/\.(?:writeTextFileSync|writeTextFile|remove|removeSync)\s*\(/g, (args) => [args[0]]],
  [/\b(?:copyFileSync|copyFile)\s*\(/g, (args) => [args[1]]],
  [/\b(?:renameSync|rename)\s*\(/g, (args) => [args[0], args[1]]],
];
const RUBY = [
  [/\b(?:File|IO)\.(?:write|binwrite|rename|delete|unlink)\s*\(?/g, (args) => [args[0]]],
  [/\bFile\.open\s*\(?/g, (args, vars) => (isWriteMode(args[1], vars) ? [args[0]] : [])],
  [/\bFileUtils\.(?:cp|copy|mv|move)\s*\(?/g, (args) => [args[1]]],
  [/\bFileUtils\.(?:rm|rm_f|rm_rf|touch)\s*\(?/g, (args) => [args[0]]],
];
const PERL_OPEN = /\bopen\s*\(?\s*(?:my\s+)?[$\w]+\s*,\s*(['"])\s*(\+?>>?|\+<)\s*([^'"]*)\1(?:\s*,\s*([^),;]+))?/g;

const TABLES = { python: PYTHON, js: JS, ruby: RUBY };

// A call that is not wrapped in parentheses (ruby) takes the rest of its line as arguments.
const argsAt = (source, match) => {
  const text = match[0];
  const isParenthesised = text.endsWith('(');
  const line = source.slice(match.index + text.length).split('\n')[0];
  return isParenthesised ? callArgs(source, match.index + text.length - 1) : callArgs(`(${line})`, 0);
};

const collect = (source, family, vars) => {
  const fromTable = (TABLES[family] ?? []).flatMap(([pattern, pick]) => [...source.matchAll(pattern)]
    .flatMap((match) => pick(argsAt(source, match), vars).filter((item) => item !== undefined)));
  const methods = family === 'python' ? [...source.matchAll(PYTHON_METHODS)].map((match) => match[1]) : [];
  const perlTarget = (match) => (match[3].trim() === '' ? match[4] : `'${match[3].trim()}'`);
  const opens = family === 'perl' ? [...source.matchAll(PERL_OPEN)].map(perlTarget) : [];
  return [...fromTable, ...methods, ...opens];
};

// Quoted words in the script that look like file paths (a slash or an extension, no spaces).
const quotedPaths = (source) => [...source.matchAll(/(['"])([^'"\s\\]{1,200})\1/g)].map((match) => match[2]).filter((word) => /[/.]/.test(word));

/**
 * Writes made by the inline script(s) of one shell command.
 * @param {string[]} argv the command's words (wrappers and NAME=value words are skipped)
 * @param {Array<{op?: string, target?: string, body?: string|null}>} [redirects] the command's redirects (heredoc bodies)
 * @param {Record<string, string>} [files] script files created in the same command: path -> body
 * @returns {{ isInterpreter: boolean, targets: string[], unresolved: number, mentioned: string[] }}
 *   targets are the literal paths written, unresolved counts write calls whose target is computed, mentioned lists every path-like string literal of the script.
 */
export const interpreterWrites = (argv, redirects = [], files = {}) => {
  const interpreter = interpreterOf(argv ?? []);
  if (!interpreter) return { isInterpreter: false, targets: [], unresolved: 0, mentioned: [] };
  const sources = scriptsOf(interpreter, redirects, files);
  const resolved = sources.flatMap((source) => {
    const vars = variablesOf(source);
    return collect(source, interpreter.family, vars).map((expression) => resolveExpression(expression, vars));
  });
  const targets = resolved.filter((target) => target !== null);
  const mentioned = sources.flatMap(quotedPaths);
  return { isInterpreter: true, targets: [...new Set(targets)], unresolved: resolved.length - targets.length, mentioned: [...new Set(mentioned)] };
};

/** Script files a whole command line creates: heredoc/herestring bodies keyed by the redirect target of `cat > file`. */
export const createdScriptFiles = (parsedCommands) => {
  const pairs = parsedCommands.map((command) => {
    const body = (command.redirects ?? []).find((redirect) => typeof redirect.body === 'string');
    const out = (command.redirects ?? []).find((redirect) => ['>', '>>'].includes(redirect.op));
    return body && out ? [out.target, body.body] : null;
  });
  return Object.fromEntries(pairs.filter((pair) => pair !== null));
};
