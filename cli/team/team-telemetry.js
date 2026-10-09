import fs from 'node:fs';
import { normalizeAgentId } from './team-db-task-helpers.js';

export const MODEL_PRICING = {
  'frontier-blended': { prompt: 0.0000025, completion: 0.0000100 },
  'claude-3-5-sonnet': { prompt: 0.0000030, completion: 0.0000150 },
  'gpt-4o': { prompt: 0.0000025, completion: 0.0000100 },
  'local': { prompt: 0.0000000, completion: 0.0000000 }
};

export const DEFAULT_MODEL = 'frontier-blended';

const toResultSync = (operation) => {
  try {
    return [operation(), null];
  } catch (err) {
    return [null, err];
  }
};

export const resolveModelPricing = (modelId = '') => {
  const hasModelId = typeof modelId === 'string' && Boolean(modelId);
  if (!hasModelId) return MODEL_PRICING[DEFAULT_MODEL];
  const norm = modelId.toLowerCase().trim();
  const hasExact = Object.prototype.hasOwnProperty.call(MODEL_PRICING, norm);
  if (hasExact) return MODEL_PRICING[norm];
  const isClaude = norm.includes('claude-3-5-sonnet') || norm.includes('claude-3.5-sonnet');
  if (isClaude) return MODEL_PRICING['claude-3-5-sonnet'];
  const isGpt = norm.includes('gpt-4o');
  if (isGpt) return MODEL_PRICING['gpt-4o'];
  const isLocal = norm.includes('local') || norm.includes('ollama') || norm.includes('llama');
  if (isLocal) return MODEL_PRICING['local'];
  return MODEL_PRICING[DEFAULT_MODEL];
};

export const calculateCost = (promptTokens = 0, completionTokens = 0, modelId = DEFAULT_MODEL) => {
  const isObjectCall = typeof promptTokens === 'object' && promptTokens !== null;
  if (isObjectCall) {
    const opts = promptTokens;
    const p = Number(opts.prompt ?? opts.promptTokens ?? opts.prompt_tokens ?? 0);
    const c = Number(opts.completion ?? opts.completionTokens ?? opts.completion_tokens ?? 0);
    const m = opts.model || opts.modelId || DEFAULT_MODEL;
    return calculateCost(p, c, m);
  }
  const pricing = resolveModelPricing(modelId);
  const totalCost = (Number(promptTokens || 0) * pricing.prompt) + (Number(completionTokens || 0) * pricing.completion);
  return Number(totalCost.toFixed(6));
};

// Only an explicit transcript is ever attributed to a task. Guessing (first file in some
// agent's history dir, or a shared project log) attached one unrelated transcript to every task.
export const findTranscriptLog = (options = {}) => {
  const hasExplicitPath = Boolean(options.logPath && fs.existsSync(options.logPath));
  return hasExplicitPath ? options.logPath : null;
};

const parseTokensFromEntry = (entry) => {
  const hasExplicitTokens = Boolean(entry.tokens);
  if (hasExplicitTokens) {
    return [Number(entry.tokens.prompt ?? entry.tokens.prompt_tokens ?? 0), Number(entry.tokens.completion ?? entry.tokens.completion_tokens ?? 0), Number(entry.tokens.cached ?? entry.tokens.cached_tokens ?? 0)];
  }
  const hasUsage = Boolean(entry.usage);
  if (hasUsage) {
    return [Number(entry.usage.prompt_tokens ?? entry.usage.input_tokens ?? 0), Number(entry.usage.completion_tokens ?? entry.usage.output_tokens ?? 0), Number(entry.usage.cached_tokens ?? 0)];
  }
  const textLen = (entry.content || '').length;
  const toolLen = entry.tool_calls ? JSON.stringify(entry.tool_calls).length : 0;
  const est = Math.ceil((textLen + toolLen) / 4);
  const isModel = entry.source === 'MODEL' || entry.type === 'PLANNER_RESPONSE';
  return isModel ? [0, est, 0] : [est, 0, 0];
};

export const parseTranscriptFile = (filePath, options = {}) => {
  let [p, c, k] = [0, 0, 0];
  const fileExists = Boolean(filePath && fs.existsSync(filePath));
  if (!fileExists) return { promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0, costUsd: 0 };
  let detectedModel = options.model || options.modelId || null;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const isBlankLine = !line.trim();
    if (isBlankLine) continue;
    const [parsed, parseErr] = toResultSync(() => JSON.parse(line));
    const isValid = Boolean(parsed) && !parseErr;
    if (!isValid) continue;
    const entryModel = parsed.model || parsed.model_id || parsed.modelId;
    const canAdoptModel = !detectedModel && Boolean(entryModel);
    if (canAdoptModel) detectedModel = entryModel;
    const [dp, dc, dk] = parseTokensFromEntry(parsed);
    p += dp; c += dc; k += dk;
  }
  const tot = p + c;
  const costUsd = calculateCost(p, c, detectedModel || DEFAULT_MODEL);
  return { promptTokens: p, completionTokens: c, cachedTokens: k, totalTokens: tot, costUsd };
};

const readExplicitTokens = (tokens, model) => {
  const p = Number(tokens.prompt ?? tokens.prompt_tokens ?? 0);
  const c = Number(tokens.completion ?? tokens.completion_tokens ?? 0);
  const k = Number(tokens.cached ?? tokens.cached_tokens ?? 0);
  const tot = Number(tokens.total ?? tokens.total_tokens ?? (p + c));
  const cost = Number(tokens.cost_usd ?? calculateCost(p, c, tokens.model || tokens.modelId || model));
  return { p, c, k, tot, cost, source: 'tokens' };
};

const readTranscriptTokens = (logPath, model) => {
  const parsed = parseTranscriptFile(logPath, { model });
  return { p: parsed.promptTokens, c: parsed.completionTokens, k: parsed.cachedTokens, tot: parsed.totalTokens, cost: parsed.costUsd, source: 'log' };
};

// A task's token stamp; a task never measured (telemetry_source NULL) is unknown, not zero.
export const isTelemetryMeasured = (task = {}) => Boolean(task.telemetry_source);

export const formatTaskTokenStamp = (task = {}) => {
  if (!isTelemetryMeasured(task)) return '[tokens: unknown]';
  const p = Number(task.prompt_tokens || 0);
  const c = Number(task.completion_tokens || 0);
  return `[P: ${p} | C: ${c} | Cost: $${Number(task.cost_usd || 0).toFixed(4)}]`;
};

// Returns null (unknown) when the caller supplied neither tokens nor an existing --log transcript.
export const ingestTaskTelemetry = (db, taskId, agentId, options = {}) => {
  const canIngest = Boolean(db && taskId);
  if (!canIngest) return null;
  const model = options.model || options.modelId || options.model_id || DEFAULT_MODEL;
  const hasTokens = Boolean(options.tokens);
  const logPath = hasTokens ? null : findTranscriptLog(options);
  const hasSource = hasTokens || Boolean(logPath);
  if (!hasSource) return null;

  const usage = hasTokens ? readExplicitTokens(options.tokens, model) : readTranscriptTokens(logPath, model);
  const { p, c, k, tot, cost } = usage;
  db.prepare('UPDATE agent_tasks SET prompt_tokens=?, completion_tokens=?, cached_tokens=?, total_tokens=?, cost_usd=?, telemetry_source=? WHERE id=?')
    .run(p, c, k, tot, cost, usage.source, Number(taskId));
  const cleanId = normalizeAgentId(agentId);
  if (cleanId) {
    db.prepare('UPDATE agents SET total_prompt_tokens=total_prompt_tokens+?, total_completion_tokens=total_completion_tokens+?, total_tokens=total_tokens+?, total_cost_usd=total_cost_usd+? WHERE id=?')
      .run(p, c, tot, cost, cleanId);
  }
  return { prompt_tokens: p, completion_tokens: c, cached_tokens: k, total_tokens: tot, cost_usd: cost, source: usage.source };
};
