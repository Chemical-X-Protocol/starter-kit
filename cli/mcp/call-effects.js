// Side-effect classification for MCP calls beyond plain file writes:
// shell execution (caller-supplied command), external publishing, and killing the server.
import fs from 'node:fs';
import path from 'node:path';

const COMMAND_ACTIONS = new Set(['build', 'test', 'typecheck']);
const SCRIPT_RUNNER = /^(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+([\w:.@/-]+)$/;

export const EFFECTS = Object.freeze({ SHELL: 'shell', PUBLISH: 'publish', KILL: 'kill', WRITE: 'write' });

export const classifyEffects = ({ action, params = {} }) => {
  const effects = new Set();
  const hasCommand = COMMAND_ACTIONS.has(action) && typeof params.command === 'string' && params.command.trim().length > 0;
  if (hasCommand) effects.add(EFFECTS.SHELL);
  const isPublishingIssue = action === 'issue' && Boolean(params.autoPost);
  if (isPublishingIssue) effects.add(EFFECTS.PUBLISH);
  const isServerRestart = action === 'check' && params.path === 'RESTART_MCP';
  if (isServerRestart) effects.add(EFFECTS.KILL);
  const isTriageAudit = action === 'audit' && Boolean(params.triage);
  if (isTriageAudit) effects.add(EFFECTS.WRITE);
  return effects;
};

const readScripts = (dir) => {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).scripts || {};
  } catch (err) {
    process.stderr.write(`[mcp] cannot read scripts from ${pkgPath}: ${err.message}\n`);
    return {};
  }
};

const normalize = (command) => command.trim().replace(/\s+/g, ' ');

// A caller-supplied command is allowed only when it is the project's own script (or runs one by name).
export const isProjectScriptCommand = (command, dir) => {
  const scripts = readScripts(dir);
  const wanted = normalize(command);
  const isScriptBody = Object.values(scripts).some((body) => typeof body === 'string' && normalize(body) === wanted);
  const runnerMatch = wanted.match(SCRIPT_RUNNER);
  const isNamedScript = Boolean(runnerMatch) && Object.hasOwn(scripts, runnerMatch[1]);
  return isScriptBody || isNamedScript;
};

export const checkShellCommand = ({ command, root, dir = null, env = process.env }) => {
  const isShellAllowed = env.CHEMX_MCP_ALLOW_SHELL === '1';
  if (isShellAllowed) return { ok: true };
  const scriptDir = dir ? path.resolve(root, dir) : root;
  if (isProjectScriptCommand(command, scriptDir)) return { ok: true };
  return {
    ok: false,
    error: `Refusing caller-supplied command "${command}": it is not a package.json script in ${scriptDir}. Omit command to use the detected runner, pass "npm run <script>", or start the server with CHEMX_MCP_ALLOW_SHELL=1.`
  };
};
