/**
 * Chemical X Protocol: read a Claude Code workflow run from disk and measure each agent's usage (#2497).
 * A run lives at ~/.claude/projects/<project>/<session>/subagents/workflows/<wf_id>/ with a journal.jsonl,
 * agent-<id>.jsonl transcripts and agent-<id>.meta.json files. Guarantee: tokens are exactly what the
 * transcripts record, counted once per message.id. Not guaranteed: transcripts of agents the host never
 * wrote (killed before the first reply) are absent, so they are absent here too.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTranscript } from './usage-transcript.js';

const AGENT_FILE_RE = /^agent-(.+)\.jsonl$/;

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const listDirs = (p) => {
  try {
    return fs.readdirSync(p).map((name) => path.join(p, name)).filter(isDir);
  } catch {
    return [];
  }
};

/** Find a run dir from a path or a wf_ id. projectsRoot defaults to ~/.claude/projects. */
export const findRunDir = (idOrDir, projectsRoot = path.join(os.homedir(), '.claude', 'projects')) => {
  const given = path.resolve(String(idOrDir || ''));
  const isGivenDir = Boolean(idOrDir) && isDir(given);
  if (isGivenDir) return given;
  for (const project of listDirs(projectsRoot)) {
    for (const session of listDirs(project)) {
      const candidate = path.join(session, 'subagents', 'workflows', String(idOrDir));
      if (isDir(candidate)) return candidate;
    }
  }
  return null;
};

const readJsonLines = (file) => {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
};

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};

const readJournalLabels = (dir) => {
  const labels = new Map();
  for (const event of readJsonLines(path.join(dir, 'journal.jsonl'))) {
    const isStart = event.type === 'started' && Boolean(event.agentId);
    if (isStart) labels.set(event.agentId, { label: event.label || '', phase: event.phase || '' });
  }
  return labels;
};

const primaryModel = (buckets) => {
  const ranked = Object.entries(buckets).sort((a, b) => b[1].calls - a[1].calls);
  return ranked.length ? ranked[0][0] : 'unknown';
};

const readAgent = (dir, file, labels) => {
  const agentId = AGENT_FILE_RE.exec(file)[1];
  const parsed = parseTranscript(fs.readFileSync(path.join(dir, file), 'utf8'));
  const meta = readJson(path.join(dir, `agent-${agentId}.meta.json`));
  const journal = labels.get(agentId) || {};
  return {
    agentId,
    handle: parsed.handle,
    label: journal.label || meta.description || '',
    phase: journal.phase || meta.workflowPhase || '',
    model: primaryModel(parsed.buckets),
    requestedModel: meta.model || null,
    ...parsed
  };
};

/** Read every agent of a run. Returns null when the run cannot be found. */
export const readRun = (idOrDir, projectsRoot) => {
  const dir = findRunDir(idOrDir, projectsRoot);
  if (!dir) return null;
  const labels = readJournalLabels(dir);
  const files = fs.readdirSync(dir).filter((f) => AGENT_FILE_RE.test(f)).sort();
  const agents = files.map((file) => readAgent(dir, file, labels));
  const launched = [...labels.keys()];
  const missing = launched.filter((id) => !agents.some((a) => a.agentId === id));
  return { runId: path.basename(dir), dir, agents, journalAgents: launched.length, missingTranscripts: missing };
};
