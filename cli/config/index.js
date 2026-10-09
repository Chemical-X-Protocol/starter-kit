import { PROFILES, DEFAULT_PROFILE, getProfileDefaults } from './profiles.js';
import fs from 'node:fs';
import path from 'node:path';
import { findAndLoadConfigFile } from './loader.js';

/** The product pillar selection written by `chemx pillars` (null when never chosen). */
const readPillarSelection = (cwd, fileConfig) => {
  const inline = fileConfig.raw?.pillars;
  if (inline && typeof inline === 'object') return inline;
  try {
    const stored = JSON.parse(fs.readFileSync(path.join(cwd, '.chemx', 'config.json'), 'utf-8'));
    return stored?.pillars && typeof stored.pillars === 'object' ? stored.pillars : null;
  } catch {
    return null;
  }
};

const RULE_ID_SHAPE = /^[A-Z][A-Z0-9_]+$/;

const parseCliProfile = (rawArgs = []) => {
  const profileArg = rawArgs.find((arg) => arg.startsWith('--profile='));
  if (profileArg) {
    const parts = profileArg.split('=');
    return parts[1]?.trim()?.toLowerCase() || null;
  }
  return null;
};

const warnedProfiles = new Set();

/** A profile name that matches no profile is reported once on stderr, then the default applies. */
const warnUnknownProfile = (name, origin) => {
  const isAlreadyWarned = warnedProfiles.has(name);
  if (isAlreadyWarned) return;
  warnedProfiles.add(name);
  const known = Object.keys(PROFILES).join(', ');
  process.stderr.write(`chemx: unknown profile "${name}" from ${origin} (known: ${known}); using ${DEFAULT_PROFILE}\n`);
};

const resolveProfile = (cliProfile, fileConfig) => {
  const requested = cliProfile || fileConfig.profile || DEFAULT_PROFILE;
  const normalized = String(requested).toLowerCase();
  const isKnown = Object.hasOwn(PROFILES, normalized);
  if (isKnown) return { selectedProfile: normalized, unknownProfile: null };
  warnUnknownProfile(requested, cliProfile ? '--profile' : fileConfig.source);
  return { selectedProfile: DEFAULT_PROFILE, unknownProfile: requested };
};

export const loadProjectConfig = (cwd = process.cwd(), rawArgs = []) => {
  const fileConfig = findAndLoadConfigFile(cwd);
  const cliProfile = parseCliProfile(rawArgs);

  const isCliProfileExplicit = Boolean(cliProfile);
  const { selectedProfile, unknownProfile } = resolveProfile(cliProfile, fileConfig);
  const profileDefaults = getProfileDefaults(selectedProfile);

  // An explicit --profile replaces file thresholds, but per-rule settings
  // ("RULE_ID": "off" | severity) and tier globs always apply.
  const perRuleSettings = Object.fromEntries(Object.entries(fileConfig.rules || {}).filter(([key]) => RULE_ID_SHAPE.test(key)));
  const effectiveRules = {
    ...profileDefaults,
    ...(isCliProfileExplicit ? perRuleSettings : fileConfig.rules),
    ...(fileConfig.tiers ? { tiers: fileConfig.tiers } : {})
  };

  return {
    source: fileConfig.source,
    profile: selectedProfile,
    unknownProfile,
    rules: effectiveRules,
    overrides: fileConfig.overrides || [],
    pillars: readPillarSelection(cwd, fileConfig),
    raw: fileConfig.raw || {},
    stage: fileConfig.raw?.stage || 'strict'
  };
};

export { PROFILES, DEFAULT_PROFILE, getProfileDefaults, findAndLoadConfigFile };
export default loadProjectConfig;
