// Dispatch `chemx hook <name>` for Claude Code. Every hook reads one JSON payload on stdin and
// fails open: malformed input or an internal error allows the tool call and writes nothing.

import { appendFriction } from '../friction/friction-log.js';
import { buildPreToolContext, decidePreTool, toPreToolOutput } from './claude-pre-tool.js';
import { logBypassToDb } from './bypass-log.js';

const readStdin = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
};

const parsePayload = (raw) => {
  try { return { ok: true, payload: JSON.parse(raw) }; } catch { return { ok: false, payload: null }; }
};

const recordPreToolFriction = (payload, context, result, env) => {
  const command = String(payload?.tool_input?.command ?? '');
  const session = payload?.session_id ?? null;
  const isDeny = result.decision === 'deny';
  if (isDeny) return appendFriction(context.root, { kind: 'guard-deny', rule: result.rule, tool: payload.tool_name, command, session }, env);
  const isBypass = typeof result.bypassReason === 'string';
  if (isBypass) return appendFriction(context.root, { kind: 'bypass', reason: result.bypassReason, rule: result.rule, command, session }, env);
  return null;
};

// Only a bypass that overrode a matching rule is counted in the coordination db (best effort, fails open).
const recordBypassInDb = async (payload, context, result) => {
  const didOverride = result.overrode === true;
  if (!didOverride) return false;
  const command = String(payload?.tool_input?.command ?? '');
  return logBypassToDb({ root: context.root, handle: context.agentId, reason: result.bypassReason, rule: result.rule, command, session: payload?.session_id ?? null });
};

const runPreTool = async (payload, env) => {
  const context = buildPreToolContext(payload, env);
  const result = decidePreTool(payload, context);
  recordPreToolFriction(payload, context, result, env);
  await recordBypassInDb(payload, context, result);
  return toPreToolOutput(result);
};

const lazyHook = (modulePath, exportName) => async (payload, env) => (await import(modulePath))[exportName](payload, env);

export const HOOKS = {
  'claude-pre-tool': runPreTool,
  'claude-post-edit': lazyHook('./claude-post-edit.js', 'runPostEdit'),
  'session-start': lazyHook('./session-start.js', 'runSessionStart'),
  statusline: lazyHook('./statusline.js', 'runStatusline'),
};

// Returns { output, exitCode }: output is a JSON object or a plain string (statusline), or null.
export const runHook = async (name, raw, env = process.env) => {
  const hook = HOOKS[name];
  if (!hook) return { output: `Unknown hook "${name}". Known: ${Object.keys(HOOKS).join(', ')}`, exitCode: 2, isError: true };
  const { ok, payload } = parsePayload(raw || '{}');
  if (!ok) return { output: null, exitCode: 0 };
  try {
    return { output: await hook(payload, env), exitCode: 0 };
  } catch (error) {
    const isDebug = env.CHEMX_HOOK_DEBUG === '1';
    const message = error instanceof Error ? error.message : String(error);
    return { output: null, exitCode: 0, debug: isDebug ? `chemx hook ${name} failed open: ${message}` : null };
  }
};

export const runHookCli = async (args, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) => {
  const name = args[0];
  const raw = await readStdin(stdin);
  const result = await runHook(name, raw, env);
  const hasDebugMessage = Boolean(result.debug);
  if (hasDebugMessage) stderr.write(`${result.debug}\n`);
  const hasOutput = result.output !== null && result.output !== undefined;
  const stream = result.isError ? stderr : stdout;
  if (hasOutput) stream.write(typeof result.output === 'string' ? `${result.output}\n` : JSON.stringify(result.output));
  return result.exitCode;
};
