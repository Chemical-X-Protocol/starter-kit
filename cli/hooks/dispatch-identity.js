// Identity of a dispatched workflow agent (#4545). The PreToolUse payload carries transcript_path
// (.../subagents/workflows/<wf>/agent-<id>.jsonl); the sibling agent-<id>.meta.json holds the label
// ("build:#4510") and dispatch_runs maps the run (workflow id) and task to its handle (@fixes-1-4510).
// Guaranteed: a handle is returned only for a build agent whose task is in a recorded run that is
// tied to this workflow run. Not guaranteed: other roles, unrecorded runs, or a missing db return null
// and the guard then allows the call as before. Every step fails open.

import fs from 'node:fs';
import path from 'node:path';
import { parseShell } from './shell-parse.js';
import { resolveInvocation, isChemxInvocation } from './guard-invocation.js';
import { teamRootFor } from '../team/coordination-target.js';
import { closeQuietly, openExistingTeamDb, safeAll } from '../team/team-db-readonly.js';
import { findWorkflowRun } from '../team/team-dispatch-runs.js';

const TRANSCRIPT = /^agent-(.+)\.jsonl$/;
const LABEL = /^\s*build\s*:\s*#(\d+)\s*$/i;
const WORKFLOW_PARENT = path.join('subagents', 'workflows');

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
};

/** { workflowId, label, taskId, dir } from a workflow-subagent transcript path, or null. */
export const dispatchAgentFromTranscript = (transcriptPath) => {
  const hasPath = typeof transcriptPath === 'string' && transcriptPath !== '';
  if (!hasPath) return null;
  const dir = path.dirname(transcriptPath);
  const match = path.basename(transcriptPath).match(TRANSCRIPT);
  const isWorkflowDir = path.dirname(dir).endsWith(WORKFLOW_PARENT);
  const isAgentFile = Boolean(match) && isWorkflowDir;
  if (!isAgentFile) return null;
  const meta = readJson(path.join(dir, `agent-${match[1]}.meta.json`));
  const label = String(meta?.description ?? meta?.label ?? '');
  const task = label.match(LABEL);
  const isBuildLabel = Boolean(task);
  if (!isBuildLabel) return null;
  return { workflowId: path.basename(dir), label, taskId: Number(task[1]), dir };
};

const SAFE_AGENT_ID = /^[A-Za-z0-9_-]+$/;

// The session directory a transcript path belongs to: the part before `subagents`, else the main transcript minus `.jsonl`.
const sessionDirOf = (transcriptPath) => {
  const parts = transcriptPath.split(path.sep);
  const at = parts.lastIndexOf('subagents');
  return at > 0 ? parts.slice(0, at).join(path.sep) : transcriptPath.replace(/\.jsonl$/, '');
};

// <subagents dir>/**/agent-<id>.meta.json, searched downwards; a workflow agent sits in workflows/<wf>/.
const findMetaDir = (subagentsDir, agentId) => {
  const wanted = `agent-${agentId}.meta.json`;
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    const hasMeta = entries.some((entry) => entry.isFile() && entry.name === wanted);
    const isTooDeep = depth >= 3;
    const subdirs = isTooDeep ? [] : entries.filter((entry) => entry.isDirectory());
    const below = subdirs.reduce((found, entry) => found ?? walk(path.join(dir, entry.name), depth + 1), null);
    return hasMeta ? dir : below;
  };
  return walk(subagentsDir, 0);
};

/** { workflowId, label, taskId, dir } for a workflow agent named by the payload's agent_id (the documented subagent marker), else by its transcript path; null when neither identifies a build agent. */
export const dispatchAgentFromPayload = (payload) => {
  const agentId = payload?.agent_id;
  const transcript = payload?.transcript_path;
  const hasAgentId = typeof agentId === 'string' && SAFE_AGENT_ID.test(agentId);
  const hasPath = typeof transcript === 'string' && transcript !== '';
  const dir = hasAgentId && hasPath ? findMetaDir(path.join(sessionDirOf(transcript), 'subagents'), agentId) : null;
  const inWorkflow = dir !== null && path.dirname(dir).endsWith(WORKFLOW_PARENT);
  return dispatchAgentFromTranscript(inWorkflow ? path.join(dir, `agent-${agentId}.jsonl`) : transcript);
};

/** The recorded builder handle of a dispatched agent, or null. Needs a run tied to this workflow id. */
export const resolveDispatchHandle = (payload, { root, env = process.env, projectsRoot } = {}) => {
  const agent = dispatchAgentFromPayload(payload);
  if (!agent) return null;
  const teamRoot = root ? teamRootFor(root, { env }) : null;
  const db = teamRoot ? openExistingTeamDb(teamRoot) : null;
  if (!db) return null;
  try {
    const rows = safeAll(db, `SELECT r.name AS name, r.workflow_run_id AS workflowRunId, t.handle AS handle
      FROM dispatch_run_tasks t JOIN dispatch_runs r ON r.name = t.run_name
      WHERE t.task_id = ? AND t.handle != '' ORDER BY r.updated_at DESC`, [agent.taskId]);
    const scanRoot = projectsRoot ?? path.resolve(agent.dir, '..', '..', '..', '..');
    const isTied = (row) => (row.workflowRunId ? row.workflowRunId === agent.workflowId : findWorkflowRun(row.name, { db, projectsRoot: scanRoot })?.id === agent.workflowId);
    return rows.find(isTied)?.handle ?? null;
  } catch {
    return null;
  } finally {
    closeQuietly(db);
  }
};

const IDENTITY_ASSIGN = /^CHEMX_AGENT_ID=\S/;
const AS_FLAG = /^--as(?:=\S|$)/;
const isExport = (argv) => argv[0] === 'export' && argv.slice(1).some((word) => IDENTITY_ASSIGN.test(word));
const hasAsFlag = (argv) => argv.some((word, i) => AS_FLAG.test(word) && (word.includes('=') || (argv[i + 1] ?? '') !== ''));

/** True when every chemx invocation in the command names its own identity: an inline CHEMX_AGENT_ID=, --as, or an earlier `export CHEMX_AGENT_ID=` in the same command. Mentions in other commands or quoted arguments do not count. */
export const everyChemxCallCarriesIdentity = (command) => {
  let exported = false;
  const hasGap = (parsed) => {
    const isEmpty = parsed.argv.length === 0;
    exported = exported || (!isEmpty && isExport(parsed.argv));
    const isChemx = !isEmpty && isChemxInvocation(resolveInvocation(parsed.argv));
    const carries = exported || parsed.assigns.some((word) => IDENTITY_ASSIGN.test(word)) || hasAsFlag(parsed.argv);
    return isChemx && !carries;
  };
  return !parseShell(String(command ?? '')).commands.some(hasGap);
};

export const identityDenyReason = (handle) => `chemx identity: this agent is dispatched as ${handle}, but this chemx call names no identity, so locks, leases and verify would not be attributed to you. `
  + `Prefix the command: \`export CHEMX_AGENT_ID=${handle}; \` (or pass --as=${handle} to chemx team commands). `
  + 'Resolved from this agent\'s dispatch record; the hook cannot set it for you.';
