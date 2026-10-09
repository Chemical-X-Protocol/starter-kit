// Group lexer tokens into simple commands. Every command that bash would execute is returned,
// including those inside $(...), backticks, subshells, `bash -c '...'` and `eval`, so rules only
// ever see real command positions, never prose inside quotes or heredoc bodies.

import { lexShell } from './shell-lexer.js';
import { ruleTree } from '../rules.js';

const SKIPPED_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '{', '}', '!', 'esac', 'time', '[[', 'function']);
// Words after these keywords are a list or subject, not a command; skipping ends at the terminator word.
const LIST_TERMINATORS = { for: 'do', select: 'do', case: 'in' };
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/;
const SHELL_NAMES = new Set(['bash', 'sh', 'zsh', 'dash']);
const MAX_DEPTH = 4;

const PIPE_OPS = new Set(['|', '|&']);
// Operators after which a `cd` runs in a forked subshell (its effect is lost) or only maybe runs.
const SUBSHELL_OPS = new Set(['|', '|&', '&']);
const CD_NAMES = new Set(['cd', 'pushd']);
const CD_FLAGS = new Set(['-P', '-L', '-e', '-@', '--']);

// Where a command runs: literal cd words applied in order from the payload cwd, or unknown.
// The words stay raw; guard-paths resolves them because only it knows $HOME, $PWD and the root.
export const ROOT_DIR = Object.freeze({ steps: Object.freeze([]), unknown: false });
const UNKNOWN_DIR = Object.freeze({ steps: Object.freeze([]), unknown: true });

const cdTarget = (argv) => {
  const flagCount = argv.slice(1).findIndex((arg) => !CD_FLAGS.has(arg));
  const args = flagCount === -1 ? [] : argv.slice(1 + flagCount);
  const isBareCd = args.length === 0 && argv[0] === 'cd';
  const isUnresolvable = args.length === 0 || args[0] === '-';
  if (isBareCd) return '~';
  return isUnresolvable ? null : args[0];
};

const afterCd = (dir, argv) => {
  const target = cdTarget(argv);
  const isUnknown = dir.unknown || target === null;
  return isUnknown ? UNKNOWN_DIR : Object.freeze({ steps: Object.freeze([...dir.steps, target]), unknown: false });
};

const newCommand = (pipeline = 0) => ({ argv: [], assigns: [], redirects: [], subs: [], pipeline });

const isAssignmentWord = (token) => ASSIGNMENT.test(token.raw);

// `bash -c '<script>'` and `eval <words>` run their argument as a nested script.
const nestedScripts = (argv) => {
  const name = argv[0] ?? '';
  const isShell = SHELL_NAMES.has(name.split('/').pop());
  if (isShell) {
    const flagIndex = argv.findIndex((arg, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(arg));
    const hasScript = flagIndex !== -1 && argv[flagIndex + 1] !== undefined;
    return hasScript ? [argv[flagIndex + 1]] : [];
  }
  const isEval = name === 'eval';
  return isEval ? [argv.slice(1).join(' ')] : [];
};

// Classify one word token against the command being built: keyword, list word, assignment or argv.
const classifyWord = (token, current, parser) => {
  const isCommandPosition = () => current.argv.length === 0;
  const isBareCommandWord = () => isCommandPosition() && !token.quoted;
  return ruleTree({
    word: {
      inList: Boolean(parser.skippingList),
      keyword: () => isBareCommandWord() && SKIPPED_KEYWORDS.has(token.value),
      listKeyword: () => isBareCommandWord() && Object.hasOwn(LIST_TERMINATORS, token.value),
      assignment: () => isCommandPosition() && isAssignmentWord(token)
    }
  }, { failFast: true });
};

const WORD_HANDLERS = {
  'word.inList': (token, current, parser) => {
    const isTerminator = !token.quoted && token.value === parser.skippingList;
    if (isTerminator) parser.skippingList = null;
  },
  'word.keyword': () => {},
  'word.listKeyword': (token, current, parser) => { parser.skippingList = LIST_TERMINATORS[token.value]; },
  'word.assignment': (token, current) => { current.assigns.push(token.value); }
};

const pushArgv = (token, current) => { current.argv.push(token.value); };

const placeWord = (token, current, parser) => {
  const gate = classifyWord(token, current, parser);
  const handler = WORD_HANDLERS[gate.first] ?? pushArgv;
  handler(token, current, parser);
};

// Directory effect of a finished command: `cd`/`pushd` change it when they run in the current shell
// (not in a pipeline stage or background job); a `cd` after `||` or `popd` makes it unknown.
const nextDir = (parser, command, endOperator) => {
  const name = command.argv[0];
  const isPopd = name === 'popd';
  if (isPopd) return UNKNOWN_DIR;
  const isCd = CD_NAMES.has(name);
  if (!isCd) return parser.dir;
  const isForked = SUBSHELL_OPS.has(endOperator) || SUBSHELL_OPS.has(parser.previousOperator);
  if (isForked) return parser.dir;
  return parser.previousOperator === '||' ? UNKNOWN_DIR : afterCd(parser.dir, command.argv);
};

const groupTokens = (tokens, initialDir = ROOT_DIR) => {
  const commands = [];
  const comments = [];
  const parser = { skippingList: null, pendingRedirect: null, pipeline: 0, dir: initialDir, previousOperator: null, subshells: [] };
  let current = newCommand();

  const recordCommand = (command, operator) => {
    command.dir = parser.dir;
    commands.push(command);
    parser.dir = nextDir(parser, command, operator);
  };

  // Commands joined by | or |& share a pipeline number; any other operator starts a new pipeline.
  const finish = (operator = null) => {
    const hasContent = current.argv.length + current.assigns.length + current.redirects.length + current.subs.length > 0;
    if (hasContent) recordCommand(current, operator);
    parser.previousOperator = operator;
    const isPipe = PIPE_OPS.has(operator);
    if (!isPipe) parser.pipeline += 1;
    current = newCommand(parser.pipeline);
  };

  // `( ... )` runs in a subshell: directory changes inside it are gone at the closing paren.
  const trackSubshell = (operator) => {
    const isOpen = operator === '(';
    if (isOpen) parser.subshells.push(parser.dir);
    const isClose = operator === ')' && parser.subshells.length > 0;
    if (isClose) parser.dir = parser.subshells.pop();
  };

  for (const token of tokens) {
    const isComment = token.type === 'comment';
    if (isComment) { comments.push(token.value); continue; }
    const isOperator = token.type === 'op';
    if (isOperator) { parser.pendingRedirect = null; parser.skippingList = null; finish(token.value); trackSubshell(token.value); continue; }
    const isRedirect = token.type === 'redir';
    if (isRedirect) {
      parser.pendingRedirect = { op: token.op, fd: token.fd, target: '', body: null, token };
      current.redirects.push(parser.pendingRedirect);
      continue;
    }
    current.subs.push(...token.subs);
    const isRedirectTarget = parser.pendingRedirect !== null;
    if (isRedirectTarget) { parser.pendingRedirect.target = token.value; parser.pendingRedirect = null; continue; }
    placeWord(token, current, parser);
  }
  finish();
  return { commands, comments };
};

// Heredoc bodies keep their redirect token, so read the body after lexing finished.
const attachBodies = (commands) => {
  for (const command of commands) {
    for (const redirect of command.redirects) redirect.body = redirect.token.body ?? null;
  }
};

export const parseShell = (source, depth = 0, initialDir = ROOT_DIR) => {
  const { commands, comments } = groupTokens(lexShell(String(source ?? '')), initialDir);
  attachBodies(commands);
  for (const command of commands) command.depth = depth;
  const isTooDeep = depth >= MAX_DEPTH;
  if (isTooDeep) return { commands, comments };
  const nested = [];
  for (const command of commands) {
    const scripts = [...command.subs, ...nestedScripts(command.argv)];
    for (const script of scripts) nested.push(...parseShell(script, depth + 1, command.dir).commands);
  }
  return { commands: [...commands, ...nested], comments };
};
