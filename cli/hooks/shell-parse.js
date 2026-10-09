// Group lexer tokens into simple commands. Every command that bash would execute is returned,
// including those inside $(...), backticks, subshells, `bash -c '...'` and `eval`, so rules only
// ever see real command positions, never prose inside quotes or heredoc bodies.

import { lexShell } from './shell-lexer.js';

const SKIPPED_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '{', '}', '!', 'esac', 'time', '[[', 'function']);
// Words after these keywords are a list or subject, not a command; skipping ends at the terminator word.
const LIST_TERMINATORS = { for: 'do', select: 'do', case: 'in' };
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/;
const SHELL_NAMES = new Set(['bash', 'sh', 'zsh', 'dash']);
const MAX_DEPTH = 4;

const newCommand = () => ({ argv: [], assigns: [], redirects: [], subs: [] });

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
const placeWord = (token, current, parser) => {
  if (parser.skippingList) {
    const isTerminator = !token.quoted && token.value === parser.skippingList;
    if (isTerminator) parser.skippingList = null;
    return;
  }
  const isCommandPosition = current.argv.length === 0;
  const isBareCommandWord = isCommandPosition && !token.quoted;
  const isKeyword = isBareCommandWord && SKIPPED_KEYWORDS.has(token.value);
  if (isKeyword) return;
  const isListKeyword = isBareCommandWord && Object.hasOwn(LIST_TERMINATORS, token.value);
  if (isListKeyword) { parser.skippingList = LIST_TERMINATORS[token.value]; return; }
  const isAssignment = isCommandPosition && isAssignmentWord(token);
  if (isAssignment) { current.assigns.push(token.value); return; }
  current.argv.push(token.value);
};

const groupTokens = (tokens) => {
  const commands = [];
  const comments = [];
  const parser = { skippingList: null, pendingRedirect: null };
  let current = newCommand();

  const finish = () => {
    const hasContent = current.argv.length + current.assigns.length + current.redirects.length + current.subs.length > 0;
    if (hasContent) commands.push(current);
    current = newCommand();
  };

  for (const token of tokens) {
    if (token.type === 'comment') { comments.push(token.value); continue; }
    if (token.type === 'op') { parser.pendingRedirect = null; parser.skippingList = null; finish(); continue; }
    if (token.type === 'redir') {
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

export const parseShell = (source, depth = 0) => {
  const { commands, comments } = groupTokens(lexShell(String(source ?? '')));
  attachBodies(commands);
  const isTooDeep = depth >= MAX_DEPTH;
  if (isTooDeep) return { commands, comments };
  const nested = [];
  for (const command of commands) {
    const scripts = [...command.subs, ...nestedScripts(command.argv)];
    for (const script of scripts) nested.push(...parseShell(script, depth + 1).commands);
  }
  return { commands: [...commands, ...nested], comments };
};
