/**
 * Chemical X Protocol: parse one Claude Code agent transcript (agent-<id>.jsonl) into measured usage (#2497).
 *
 * Claude Code writes one jsonl entry per content block (thinking, text, tool_use) and repeats the same
 * message.usage on each. Summing entries inflates totals about 2x, so usage is counted once per
 * message.id. Entries of one id can differ while streaming (output_tokens grows), so the field-wise
 * maximum across the id's entries is the final value.
 */

const HANDLE_RE = /You are[^@\n]{0,40}(@[\w-]+)/;
const ENV_HANDLE_RE = /CHEMX_AGENT_ID=(@[\w-]+)/;
const CLAIM_RE = /task claim (\d+)/g;

export const emptyTokens = () => ({ input: 0, output: 0, cacheRead: 0, write5m: 0, write1h: 0, calls: 0 });

const num = (value) => (Number.isFinite(value) ? value : 0);

/** Token counts of one usage object, with cache writes split by TTL. */
export const tokensOfUsage = (usage = {}) => {
  const created = num(usage.cache_creation_input_tokens);
  const split = usage.cache_creation;
  const write1h = num(split?.ephemeral_1h_input_tokens);
  const hasSplit = Boolean(split) && split.ephemeral_5m_input_tokens !== undefined;
  const write5m = hasSplit ? num(split.ephemeral_5m_input_tokens) : Math.max(0, created - write1h);
  return { input: num(usage.input_tokens), output: num(usage.output_tokens), cacheRead: num(usage.cache_read_input_tokens), write5m, write1h };
};

const mergeMax = (a, b) => ({
  input: Math.max(a.input, b.input), output: Math.max(a.output, b.output), cacheRead: Math.max(a.cacheRead, b.cacheRead),
  write5m: Math.max(a.write5m, b.write5m), write1h: Math.max(a.write1h, b.write1h)
});

const textOf = (content) => {
  const isText = typeof content === 'string';
  if (isText) return content;
  const blocks = Array.isArray(content) ? content : [];
  return blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
};

const commandsOf = (content) => {
  const blocks = Array.isArray(content) ? content : [];
  return blocks.filter((b) => b?.type === 'tool_use' && typeof b.input?.command === 'string').map((b) => b.input.command);
};

const parseLines = (text) => {
  const entries = [];
  for (const line of text.split('\n')) {
    const isBlank = line.trim() === '';
    if (isBlank) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // chemx-allow: best-effort a torn final line of a live transcript is skipped, never guessed at
    }
  }
  return entries;
};

const findHandle = (userTexts, commands) => {
  for (const text of userTexts) {
    const hit = HANDLE_RE.exec(text);
    if (hit) return hit[1];
  }
  for (const command of commands) {
    const hit = ENV_HANDLE_RE.exec(command);
    if (hit) return hit[1];
  }
  return null;
};

const findClaims = (commands) => {
  const ids = new Set();
  for (const command of commands) {
    for (const hit of command.matchAll(CLAIM_RE)) ids.add(Number(hit[1]));
  }
  return [...ids];
};

const timesOf = (entries) => {
  const stamps = entries.map((e) => Date.parse(e.timestamp)).filter(Number.isFinite);
  const hasStamps = stamps.length > 0;
  if (!hasStamps) return { startedAt: null, endedAt: null, wallMs: 0 };
  const startedAt = Math.min(...stamps);
  const endedAt = Math.max(...stamps);
  return { startedAt, endedAt, wallMs: endedAt - startedAt };
};

/** Dedupe assistant usage by message.id; returns per-model token buckets and entry counts. */
const dedupeUsage = (entries) => {
  const byId = new Map();
  let usageEntries = 0;
  for (const entry of entries) {
    const message = entry.message;
    const isUsage = entry.type === 'assistant' && Boolean(message?.usage);
    if (!isUsage) continue;
    usageEntries += 1;
    const key = message.id || entry.uuid;
    const tokens = tokensOfUsage(message.usage);
    const prior = byId.get(key);
    byId.set(key, { model: message.model || prior?.model || 'unknown', tokens: prior ? mergeMax(prior.tokens, tokens) : tokens });
  }
  const buckets = {};
  for (const { model, tokens } of byId.values()) {
    const bucket = (buckets[model] ||= emptyTokens());
    bucket.input += tokens.input;
    bucket.output += tokens.output;
    bucket.cacheRead += tokens.cacheRead;
    bucket.write5m += tokens.write5m;
    bucket.write1h += tokens.write1h;
    bucket.calls += 1;
  }
  return { buckets, usageEntries, messages: byId.size };
};

/** Parse the text of one transcript into { handle, claims, buckets, times, usageEntries, messages }. */
export const parseTranscript = (text) => {
  const entries = parseLines(text);
  const userEntries = entries.filter((e) => e.type === 'user').slice(0, 4);
  const userTexts = userEntries.map((e) => textOf(e.message?.content));
  const commands = entries.filter((e) => e.type === 'assistant').flatMap((e) => commandsOf(e.message?.content));
  return {
    handle: findHandle(userTexts, commands),
    claims: findClaims(commands),
    ...dedupeUsage(entries),
    ...timesOf(entries)
  };
};
