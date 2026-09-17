/**
 * Chemical X Protocol: Token Telemetry Tracking & Automated Ingestion
 * Parses runtime transcript logs or structured options to record token telemetry
 */

import fs from 'node:fs';
import path from 'node:path';
import { normalizeAgentId } from './team-db-task-helpers.js';

const toResultSync = (operation) => {
  try {
    return [operation(), null];
  } catch (err) {
    return [null, err];
  }
};

export const findTranscriptLog = (options = {}) => {
  if (options.logPath && fs.existsSync(options.logPath)) return options.logPath;
  const cwd = options.cwd || process.cwd();
  const candidates = [
    path.resolve(cwd, '.chemx/logs/transcript.jsonl'),
    path.resolve(cwd, '.system_generated/logs/transcript.jsonl')
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  const brainDir = '/home/xopher/.gemini/antigravity/brain';
  if (fs.existsSync(brainDir)) {
    for (const conv of fs.readdirSync(brainDir)) {
      const cand = path.join(brainDir, conv, '.system_generated/logs/transcript.jsonl');
      if (fs.existsSync(cand)) return cand;
    }
  }
  return null;
};

const parseTokensFromEntry = (entry) => {
  if (entry.tokens) {
    return [
      Number(entry.tokens.prompt ?? entry.tokens.prompt_tokens ?? 0),
      Number(entry.tokens.completion ?? entry.tokens.completion_tokens ?? 0),
      Number(entry.tokens.cached ?? entry.tokens.cached_tokens ?? 0)
    ];
  }
  if (entry.usage) {
    return [
      Number(entry.usage.prompt_tokens ?? entry.usage.input_tokens ?? 0),
      Number(entry.usage.completion_tokens ?? entry.usage.output_tokens ?? 0),
      Number(entry.usage.cached_tokens ?? 0)
    ];
  }
  const textLen = (entry.content || '').length;
  const toolLen = entry.tool_calls ? JSON.stringify(entry.tool_calls).length : 0;
  const est = Math.ceil((textLen + toolLen) / 4);
  const isModel = entry.source === 'MODEL' || entry.type === 'PLANNER_RESPONSE';
  return isModel ? [0, est, 0] : [est, 0, 0];
};

export const parseTranscriptFile = (filePath) => {
  let [p, c, k] = [0, 0, 0];
  const hasFilePath = Boolean(filePath);
  const pathExists = hasFilePath && fs.existsSync(filePath);
  if (!pathExists) return { promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0, costUsd: 0 };
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const [parsed, parseErr] = toResultSync(() => JSON.parse(line));
    const canProcess = Boolean(parsed) && !parseErr;
    if (!canProcess) continue;
    const [dp, dc, dk] = parseTokensFromEntry(parsed);
    p += dp; c += dc; k += dk;
  }
  const tot = p + c;
  const cost = Number(((p * 0.0000025) + (c * 0.00001)).toFixed(6));
  return { promptTokens: p, completionTokens: c, cachedTokens: k, totalTokens: tot, costUsd: cost };
};

export const ingestTaskTelemetry = (db, taskId, agentId, options = {}) => {
  const hasDb = Boolean(db);
  const hasTaskId = Boolean(taskId);
  const canIngest = hasDb && hasTaskId;
  if (!canIngest) return null;
  let p = 0, c = 0, k = 0, tot = 0, cost = 0.0;
  if (options.tokens) {
    const t = options.tokens;
    p = Number(t.prompt ?? t.prompt_tokens ?? 0);
    c = Number(t.completion ?? t.completion_tokens ?? 0);
    k = Number(t.cached ?? t.cached_tokens ?? 0);
    tot = Number(t.total ?? t.total_tokens ?? (p + c));
    cost = Number(t.cost_usd ?? ((p * 0.0000025) + (c * 0.00001)).toFixed(6));
  } else {
    const parsed = parseTranscriptFile(options.logPath || findTranscriptLog(options));
    p = parsed.promptTokens; c = parsed.completionTokens; k = parsed.cachedTokens;
    tot = parsed.totalTokens; cost = parsed.costUsd;
  }
  db.prepare(`UPDATE agent_tasks SET prompt_tokens=?, completion_tokens=?, cached_tokens=?, total_tokens=?, cost_usd=? WHERE id=?`)
    .run(p, c, k, tot, cost, Number(taskId));
  const cleanId = normalizeAgentId(agentId);
  if (cleanId) {
    db.prepare(`UPDATE agents SET total_prompt_tokens=total_prompt_tokens+?, total_completion_tokens=total_completion_tokens+?, total_tokens=total_tokens+?, total_cost_usd=total_cost_usd+? WHERE id=?`)
      .run(p, c, tot, cost, cleanId);
  }
  return { prompt_tokens: p, completion_tokens: c, cached_tokens: k, total_tokens: tot, cost_usd: cost };
};

