/**
 * Chemical X Protocol: token price table for usage telemetry (#2497).
 * Defaults are list prices as of 2026-10-09, $/MTok, edit in config: the "pricing" key of
 * .chemx/config.json overrides any rate per family, e.g. { "pricing": { "opus": { "input": 5 } } }.
 * Cache writes are priced as a multiple of input: 1.25x for the 5 minute TTL, 2x for the 1 hour TTL.
 */
import fs from 'node:fs';
import path from 'node:path';

export const PRICING_AS_OF = '2026-10-09';
export const DEFAULT_SOURCE = `list prices as of ${PRICING_AS_OF}, $/MTok, edit in config`;
export const WRITE_5M_MULT = 1.25;
export const WRITE_1H_MULT = 2;

export const DEFAULT_PRICING = {
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01 },
  sonnet: { input: 2, output: 10, cacheRead: 0.2 },
  opus: { input: 4, output: 20, cacheRead: 0.2 },
  fable: { input: 10, output: 50, cacheRead: 0.25 }
};

const FAMILY_PATTERNS = [['haiku', /haiku/i], ['sonnet', /sonnet/i], ['opus', /opus/i], ['fable', /fable/i]];

export const familyOf = (modelId = '') => {
  const hit = FAMILY_PATTERNS.find(([, re]) => re.test(String(modelId)));
  return hit ? hit[0] : null;
};

const readConfigPricing = (root) => {
  const file = path.join(root, '.chemx', 'config.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const isObject = Boolean(parsed.pricing) && typeof parsed.pricing === 'object';
    return isObject ? { overrides: parsed.pricing, file } : null;
  } catch {
    return null;
  }
};

/** Resolve the price table for a project: defaults, with per-family overrides from config. */
export const loadPricing = (root = process.cwd()) => {
  const configured = readConfigPricing(root);
  const table = {};
  for (const [family, rates] of Object.entries(DEFAULT_PRICING)) {
    table[family] = { ...rates, ...(configured?.overrides?.[family] || {}) };
  }
  const source = configured ? `${DEFAULT_SOURCE}; overrides from ${configured.file}` : DEFAULT_SOURCE;
  return { table, source };
};

/** Dollar cost of one token bucket at one family's rates. Returns null when the family is unpriced. */
export const costOfTokens = (tokens, rates) => {
  if (!rates) return null;
  const perM = 1e6;
  const write5m = rates.input * WRITE_5M_MULT;
  const write1h = rates.input * WRITE_1H_MULT;
  const total = tokens.input * rates.input + tokens.output * rates.output + tokens.cacheRead * rates.cacheRead
    + tokens.write5m * write5m + tokens.write1h * write1h;
  return total / perM;
};

export const priceBucket = (pricing, modelId, tokens) => costOfTokens(tokens, pricing.table[familyOf(modelId)]);
