#!/usr/bin/env node
// Fast entry for Claude Code hooks: `node <kit>/cli/hooks/entry.js <hook>`. Same behaviour as
// `chemx hook <hook>` but skips the full CLI boot, since PreToolUse runs before every Bash call.
//
// The rule modules load with a dynamic import. If that import throws (syntax error, missing file),
// claude-pre-tool applies a small built-in ruleset instead of failing open, and a `guard-crash`
// feed event with the load error is posted, at most once per CRASH_WINDOW_MS per root. The built-in
// rules are deliberately coarse and are NOT the full guard: they cover shell writes into repo
// files, git diff/log/show, cat and sed -n on source files, native Edit/Write on repo files, and
// native Read/Glob/Grep on repo paths (a Glob or Grep with no path counts as the repo).
// Only if the fallback itself throws does the call go through unchecked. Other hooks fail open.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const CRASH_EVENT_TYPE = 'guard-crash';
export const CRASH_WINDOW_MS = 60_000;
const BUSY_TIMEOUT_MS = 400;
const SOURCE_EXT = '(?:js|mjs|cjs|ts|tsx|jsx|vue|json|php|py|sh|md|css|scss|html|yml|yaml)';
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const BYPASS_PATTERN = /#\s*chemx-bypass:\s*\S/;

const FALLBACK_BASH_RULES = [
  { rule: 'fallback-shell-write', pattern: /(?:^|[\s;&|(])sed\s+(?:-[a-zA-Z]*\s+)*(?:-[a-zA-Z]*i|--in-place)|(?:^|[\s;&|(])perl\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*i|(?:^|[\s;&|(])(?:cp|mv|install)\s|(?:^|[\s;&|(])dd\s[^|;&]*\bof=|(?:^|[\s;&|(])tee\s|(?:^|[^>&0-9])>>?\s*(?!\/dev\/|&)[^\s&|;]+/, hint: 'write files with chemx patch or chemx write' },
  { rule: 'fallback-git-read', pattern: /(?:^|[\s;&|(])git\s+(?:(?:-C|-c)\s+\S+\s+|-[^\s]+\s+)*(?:diff|log|show)\b/, hint: 'use chemx d or chemx log' },
  { rule: 'fallback-cat-source', pattern: new RegExp(`(?:^|[\\s;&|(])cat\\s+[^|;&]*\\.${SOURCE_EXT}\\b`), hint: 'use chemx read' },
  { rule: 'fallback-sed-n', pattern: new RegExp(`(?:^|[\\s;&|(])sed\\s+-n\\b[^|;&]*\\.${SOURCE_EXT}\\b`), hint: 'use chemx read <file>:<a>-<b>' },
];

const deny = (rule, hint, loadError) => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: `chemx guard rules failed to load (${loadError}); built-in fallback rule ${rule} denied this call: ${hint}. The fallback is coarse. Fix the guard module, or append "# chemx-bypass: <reason>" to a Bash command.`,
  },
});

const isInsideRepo = (file, root) => {
  const resolved = path.resolve(root, file);
  const rel = path.relative(root, resolved);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

const fallbackEdit = (input, root, loadError) => {
  const file = input.file_path ?? input.notebook_path;
  const isRepoFile = typeof file === 'string' && isInsideRepo(file, root);
  return isRepoFile ? deny('fallback-native-edit', 'use chemx patch or chemx write', loadError) : null;
};

// Read names a file; Glob and Grep name a directory, or none, which means the working directory.
const fallbackRead = (tool, input, root, loadError) => {
  const target = input.file_path ?? input.path;
  const hasTarget = typeof target === 'string' && target !== '';
  const isRepoTarget = hasTarget ? isInsideRepo(target, root) : tool !== 'Read';
  return isRepoTarget ? deny('fallback-native-read', 'use chemx read, chemx q or chemx f', loadError) : null;
};

// Returns a PreToolUse output object (deny) or null (allow).
export const fallbackPreTool = (payload, env, loadError) => {
  const root = env.CLAUDE_PROJECT_DIR || payload?.cwd || process.cwd();
  const tool = payload?.tool_name;
  const input = payload?.tool_input ?? {};
  const isFileTool = FILE_TOOLS.has(tool);
  if (isFileTool) return fallbackEdit(input, root, loadError);
  const isReadTool = READ_TOOLS.has(tool);
  if (isReadTool) return fallbackRead(tool, input, root, loadError);
  const isBash = tool === 'Bash';
  if (!isBash) return null;
  const command = String(input.command ?? '');
  const hasBypass = BYPASS_PATTERN.test(command);
  if (hasBypass) return null;
  const hit = FALLBACK_BASH_RULES.find((entry) => entry.pattern.test(command));
  return hit ? deny(hit.rule, hit.hint, loadError) : null;
};

export const claimWindow = (root, now) => {
  const key = crypto.createHash('sha1').update(root).digest('hex').slice(0, 12);
  const marker = path.join(os.tmpdir(), `chemx-guard-crash-${key}`);
  try {
    const last = Number(fs.readFileSync(marker, 'utf-8'));
    const isRecent = now - last < CRASH_WINDOW_MS;
    if (isRecent) return false;
  } catch { /* chemx-allow: best-effort no marker yet means no recent crash */ }
  fs.writeFileSync(marker, String(now));
  return true;
};

// Best effort, rate limited, never throws. Appends only to an existing coordination db.
export const postGuardCrash = async ({ root, handle, hookName, loadError, now = Date.now() }) => {
  try {
    const isClaimed = claimWindow(root, now);
    if (!isClaimed) return false;
    const { resolveTeamDbTarget } = await import('../team/coordination-target.js');
    const { postFeedEvent } = await import('../team/team-db-feed.js');
    const { DatabaseSync } = await import('node:sqlite');
    const target = resolveTeamDbTarget(root);
    const hasDb = !target.refused && fs.existsSync(target.dbPath);
    if (!hasDb) return false;
    const db = new DatabaseSync(target.dbPath);
    try {
      db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
      const message = `guard-crash ${hookName}: ${loadError}`.slice(0, 500);
      return postFeedEvent(db, { author_id: handle ?? '@claude', event_type: CRASH_EVENT_TYPE, message, metadata: { hook: hookName, error: loadError } }) !== null;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
};

const readStdin = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
};

const fallbackRun = async (name, raw, env, stdout, loadError) => {
  try {
    const payload = JSON.parse(raw || '{}');
    const root = env.CLAUDE_PROJECT_DIR || payload?.cwd || process.cwd();
    await postGuardCrash({ root, handle: env.CHEMX_AGENT_ID, hookName: name, loadError });
    const output = name === 'claude-pre-tool' ? fallbackPreTool(payload, env, loadError) : null;
    if (output) stdout.write(JSON.stringify(output));
  } catch { /* chemx-allow: best-effort even the fallback failed, so fail open */ }
  return 0;
};

// `loader` is injectable so a spec can point at a guard dir whose module throws on import.
export const runEntry = async (args, { stdin = process.stdin, stdout = process.stdout, env = process.env, loader = () => import('./run-hook.js') } = {}) => {
  let mod;
  try {
    mod = await loader();
  } catch (error) {
    const loadError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return fallbackRun(args[0], await readStdin(stdin), env, stdout, loadError);
  }
  return mod.runHookCli(args, { stdin, stdout, env });
};

const isMain = () => {
  try { return pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; }
};

if (isMain()) process.exitCode = await runEntry(process.argv.slice(2));
