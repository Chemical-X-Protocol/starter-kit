/**
 * Rollout stages (design spec 4.4). effectiveStage(lang, capability, root) resolves the record
 * default, then `.chemxrc` languages, then CHEMX_LANG_STAGE (and withStages overrides in specs),
 * then the kill switch CHEMX_LANG_ENGINE=legacy, which restores the pre-program path.
 * With no config the result is the record default, which is today's behavior.
 */
import { getLanguage } from './registry.js';
import { CAPABILITIES, STAGES } from './vocab.js';
import { loadProjectConfig } from '../config/index.js';

const CONFIG_TTL_MS = 1000;
// Engines that already are today's path: the legacy kill switch leaves their stages alone.
const NEW_ENGINES = new Set(['tree-sitter', 'regex']);
const SLOT_FOR_CAPABILITY = { source: 'index', index: 'index', imports: 'index', outline: 'outline', editGate: 'editGate', audit: 'audit' };

const configCache = new Map();
const overrides = [];

/** Drops cached `.chemxrc` reads (specs, and callers that just rewrote the file). */
export const resetRolloutCache = () => configCache.clear();

const languagesConfig = (root) => {
  const cached = configCache.get(root);
  const isFresh = cached && Date.now() - cached.at < CONFIG_TTL_MS;
  if (isFresh) return cached.value;
  let value;
  try {
    value = loadProjectConfig(root).languages;
  } catch {
    value = null;
  }
  configCache.set(root, { at: Date.now(), value });
  return value;
};

/** Parses "lang:cap=stage" entries separated by commas or whitespace; malformed entries are skipped. */
const parseEnvStages = (text = '') => {
  const entries = [];
  for (const part of text.split(/[\s,]+/)) {
    const match = /^([a-z][a-z0-9]*):([A-Za-z]+)=([a-z]+)$/.exec(part);
    const isValid = match && CAPABILITIES.includes(match[2]) && STAGES.includes(match[3]);
    if (isValid) entries.push({ lang: match[1], cap: match[2], stage: match[3] });
  }
  return entries;
};

// requireGrammars means a vetted grammar; an experimental one does not count.
const hasGrammar = (record) => record.parse.grammarStatus === 'vetted';

const isGrammarRequired = (config, id) => config.requireGrammars === true || config.requireGrammars.includes(id);

const clampLegacy = (record, capability, stage) => {
  const slot = SLOT_FOR_CAPABILITY[capability];
  const isNewEngine = NEW_ENGINES.has(record.engines[slot]);
  const isRolledOut = stage === 'shadow' || stage === 'on';
  return isNewEngine && isRolledOut ? 'text' : stage;
};

/** The `.chemxrc` layer: configured stage, then requireGrammars, then disable. */
const applyConfig = (record, capability, base, config) => {
  if (!config) return base;
  if (config.disable.includes(record.id)) return 'off';
  const stage = config.stages[record.id]?.[capability] ?? base;
  const isRolledOut = stage === 'shadow' || stage === 'on';
  const isMissingGrammar = isGrammarRequired(config, record.id) && !hasGrammar(record);
  return isRolledOut && isMissingGrammar ? 'text' : stage;
};

const overrideFor = (lang, capability) => {
  for (let i = overrides.length - 1; i >= 0; i--) {
    const hit = overrides[i][`${lang}:${capability}`] ?? overrides[i][`${lang}:*`];
    if (hit) return hit;
  }
  return null;
};

/** The stage a capability of a language runs at for a project root: 'off' | 'text' | 'shadow' | 'on'. */
export const effectiveStage = (lang, capability, root = process.cwd()) => {
  const record = getLanguage(lang);
  if (!record) return 'off';
  const base = record.stages[capability] ?? 'off';
  const isKillSwitchOn = process.env.CHEMX_LANG_ENGINE === 'legacy';
  if (isKillSwitchOn) return clampLegacy(record, capability, base);

  const configured = applyConfig(record, capability, base, languagesConfig(root));
  const fromEnv = parseEnvStages(process.env.CHEMX_LANG_STAGE).findLast((e) => e.lang === lang && e.cap === capability);
  return overrideFor(lang, capability) ?? fromEnv?.stage ?? configured;
};

/** True when the new engine should also run beside today's output and log diffs (`.chemxrc` languages.shadow or CHEMX_LANG_SHADOW=1). */
export const isShadowLogging = (root = process.cwd()) => process.env.CHEMX_LANG_SHADOW === '1' || Boolean(languagesConfig(root)?.shadow);

/**
 * Test helper: forces stages, keyed "lang:capability" or "lang:*". With a callback the override
 * lasts for the call (sync or async) and its result is returned; without one it returns a restore function.
 */
export const withStages = (map, fn) => {
  overrides.push(map);
  const restore = () => {
    const index = overrides.indexOf(map);
    const isActive = index !== -1;
    if (isActive) overrides.splice(index, 1);
  };
  if (!fn) return restore;
  let result;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  const isThenable = typeof result?.then === 'function';
  return isThenable ? result.finally(restore) : (restore(), result);
};
