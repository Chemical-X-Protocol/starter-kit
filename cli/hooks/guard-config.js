// Guard settings that come from .chemxrc (or .chemx/config.json). Nudges are advisory by default.
//   guardNudges: "block"                  promotes every nudge to a block
//   guardNudgeBlock: ["nudge-git-status"]  promotes only the listed nudge rule ids
// $CHEMX_GUARD_NUDGES=block|nudge overrides guardNudges for one process. Any read error means
// "no promotion", so a broken config never blocks a tool call.

import { findAndLoadConfigFile } from '../config/loader.js';

export const NUDGE_MODE_KEY = 'guardNudges';
export const NUDGE_IDS_KEY = 'guardNudgeBlock';
export const NUDGE_ENV = 'CHEMX_GUARD_NUDGES';

const NO_PROMOTION = { all: false, ids: [] };

const fromEnvironment = (env) => {
  const value = String(env[NUDGE_ENV] ?? '').trim().toLowerCase();
  const isBlock = value === 'block';
  const isNudge = value === 'nudge';
  if (isBlock) return { all: true, ids: [] };
  return isNudge ? NO_PROMOTION : null;
};

const fromConfig = (raw) => {
  const isBlockAll = String(raw[NUDGE_MODE_KEY] ?? '').trim().toLowerCase() === 'block';
  const listed = Array.isArray(raw[NUDGE_IDS_KEY]) ? raw[NUDGE_IDS_KEY].filter((id) => typeof id === 'string') : [];
  return { all: isBlockAll, ids: listed };
};

export const resolveNudgePromotion = (root, env = process.env) => {
  const fromEnv = fromEnvironment(env);
  if (fromEnv) return fromEnv;
  try {
    return fromConfig(findAndLoadConfigFile(root)?.raw ?? {});
  } catch {
    return NO_PROMOTION; // an unreadable config means advisory nudges, never a block
  }
};

export const isPromotedNudge = (rule, promotion) => {
  const isNudge = rule.severity === 'nudge';
  const isPromoted = Boolean(promotion) && (promotion.all || promotion.ids.includes(rule.id));
  return isNudge && isPromoted;
};
