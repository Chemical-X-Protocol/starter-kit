/**
 * Chemical X Protocol: turn one recorded tool call into invocations the audit can classify (#2561).
 * A Bash call becomes one invocation per simple command (the guard's parseShell, so quotes, heredoc bodies
 * and `bash -c` are handled the way the guard handles them). A chemx MCP call becomes one chemx
 * invocation per command it carries. A native file tool becomes one native invocation.
 *
 * Invocation: { via: 'bash'|'mcp'|'native', kind: 'chemx'|'shell'|'native', at, cwd, raw, argv, redirects,
 *   isPiped, isScratch, tool?, path? }. For chemx invocations argv starts after the chemx word.
 *
 * Limits: a path built from a variable, a glob or command substitution cannot be resolved; it is reported
 * as written. A write made by an interpreter (node -e, python -c) is not seen.
 */
import { parseShell } from '../hooks/shell-parse.js';
import { CHEMX_MCP_TOOL, isFileTool } from './audit-run-calls.js';

const SCRATCH_RE = /(^|[\s'"=:(<>])\/(var\/)?tmp\b|mktemp|~\/\.claude|\/\.claude\/|\$\{?TMPDIR|\$\{?HOME\}?\/\.claude/;
const WRAPPERS = new Set(['env', 'command', 'exec', 'nohup', 'sudo', 'time']);
const RUNNERS = new Set(['pnpm', 'npx', 'pnpx', 'bunx']);
const QUOTED_WORD = /"[^"]*"|'[^']*'|\S+/g;

/** Does the text touch scratch space (/tmp, mktemp, ~/.claude)? Scratch work is never an audit finding. */
export const isScratchText = (text) => SCRATCH_RE.test(String(text ?? ''));

const unquote = (word) => word.replace(/^(["'])(.*)\1$/, '$2');
const wordsOf = (text) => (String(text).match(QUOTED_WORD) ?? []).map(unquote);

// The argv after the chemx word, or null when the command is not chemx.
const chemxArgs = (argv) => {
  let rest = argv;
  const isWrapped = () => rest.length > 0 && WRAPPERS.has(rest[0]);
  while (isWrapped()) rest = rest.slice(1);
  const hasRunner = rest.length > 1 && RUNNERS.has(rest[0]);
  if (hasRunner) rest = rest.slice(1);
  const head = rest[0] ? rest[0].split('/').pop() : '';
  const isChemx = head === 'chemx';
  return isChemx ? rest.slice(1) : null;
};

// NAME=value words of one command as an object (quotes stripped; later words win).
const assignmentsOf = (words = []) => Object.fromEntries(words.map((w) => {
  const at = w.indexOf('=');
  return [w.slice(0, at), unquote(w.slice(at + 1))];
}).filter(([name]) => /^[A-Za-z_]\w*$/.test(name)));

const bashInvocations = (call) => {
  const command = String(call.input.command ?? '');
  const { commands } = parseShell(command);
  const isScratch = isScratchText(command);
  const result = [];
  const vars = {};
  const isOneEdit = commands.filter((cmd) => chemxArgs(cmd.argv)?.[0] === 'patch').length === 1;
  // chemx prints 'Patched <path>:L69-70'; drop the line-range suffix so the path equals the lease key (#4568).
  const printedPath = isOneEdit && call.printedPath ? call.printedPath.replace(/:L?\d+(?:-\d+)?$/, '') : null;
  commands.forEach((cmd, index) => {
    const isEmpty = cmd.argv.length === 0 && cmd.redirects.length === 0;
    if (isEmpty) return;
    const isPiped = index > 0 && commands[index - 1].pipeline === cmd.pipeline;
    const args = chemxArgs(cmd.argv);
    const isChemx = args !== null;
    const dir = cmd.dir ?? { steps: [], unknown: false };
    const own = assignmentsOf(cmd.assigns);
    const isBareAssignment = cmd.argv.length === 0;
    if (isBareAssignment) Object.assign(vars, own);
    const ownText = [...cmd.argv, ...cmd.redirects.map((r) => r.target)].join(' ');
    const isSegmentScratch = isScratchText(ownText);
    result.push({
      via: 'bash', kind: isChemx ? 'chemx' : 'shell', at: call.at, cwd: call.cwd, raw: command,
      argv: isChemx ? args : cmd.argv, redirects: cmd.redirects, dir, isPiped, isScratch, isSegmentScratch, vars: { ...vars, ...own },
      printedPath: isChemx && args[0] === 'patch' ? printedPath : null
    });
  });
  return result;
};

// MCP params -> the CLI-shaped words the CLI path already understands.
const mcpWords = (input) => {
  const p = input.params && typeof input.params === 'object' ? input.params : {};
  const action = String(input.action ?? '');
  const sub = p.subAction ?? p.sub ?? '';
  const id = p.taskId ?? '';
  const isTeam = action === 'team' || action.startsWith('team_');
  const teamVerb = action === 'team' ? [] : [action.slice(5)];
  const team = isTeam ? ['team', ...teamVerb, sub, id, p.path ?? ''] : [];
  const flags = [p.overwrite ? '--overwrite' : '', p.append ? '--append' : ''];
  const plain = [action, p.path ?? p.query ?? p.testTarget ?? p.dir ?? '', ...flags];
  return (isTeam ? team : plain).filter((w) => w !== '' && w !== undefined);
};

const mcpInvocations = (call) => {
  const input = call.input;
  const lines = [];
  const hasCommand = typeof input.command === 'string';
  if (hasCommand) lines.push(wordsOf(input.command));
  const batch = Array.isArray(input.commands) ? input.commands : [];
  for (const line of batch) lines.push(wordsOf(line));
  const hasAction = typeof input.action === 'string';
  if (hasAction) lines.push(mcpWords(input).map(String));
  const items = Array.isArray(input.batch) ? input.batch : [];
  for (const item of items) lines.push(mcpWords(item ?? {}).map(String));
  return lines.filter((argv) => argv.length > 0).map((argv) => ({
    via: 'mcp', kind: 'chemx', at: call.at, cwd: call.cwd, raw: argv.join(' '), argv, redirects: [],
    dir: { steps: [], unknown: false }, isPiped: false, isScratch: false
  }));
};

const nativeInvocation = (call) => {
  const input = call.input;
  const path = input.file_path ?? input.notebook_path ?? input.path ?? null;
  return [{
    via: 'native', kind: 'native', tool: call.name, at: call.at, cwd: call.cwd, raw: `${call.name} ${path ?? ''}`.trim(),
    argv: [], redirects: [], dir: { steps: [], unknown: false }, isPiped: false, isScratch: false, path
  }];
};

/** Invocations of one recorded call; overhead tools (ToolSearch, StructuredOutput, ...) yield none. */
export const invocationsOf = (call) => {
  const isBash = call.name === 'Bash';
  const isMcp = call.name === CHEMX_MCP_TOOL;
  const isNative = isFileTool(call.name);
  if (isBash) return bashInvocations(call);
  if (isMcp) return mcpInvocations(call);
  return isNative ? nativeInvocation(call) : [];
};
