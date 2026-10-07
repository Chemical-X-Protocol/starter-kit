import {
  PROFILES,
  DEFAULT_PROFILE,
  getProfileDefaults,
  STRICT_MOLECULE_LINE_LIMIT,
  DEFAULT_MOLECULE_LINE_LIMIT,
  FILE_LINE_LIMIT,
  isFileLengthEnforced,
  resolveMoleculeLineLimit,
  resolveEffectiveMoleculeLineLimit
} from './profiles.js';
import { findAndLoadConfigFile } from './loader.js';

const parseCliProfile = (rawArgs = []) => {
  const profileArg = rawArgs.find((arg) => arg.startsWith('--profile='));
  if (profileArg) {
    const parts = profileArg.split('=');
    return parts[1]?.trim()?.toLowerCase() || null;
  }
  return null;
};

export const loadProjectConfig = (cwd = process.cwd(), rawArgs = []) => {
  const fileConfig = findAndLoadConfigFile(cwd);
  const cliProfile = parseCliProfile(rawArgs);

  const isCliProfileExplicit = Boolean(cliProfile);
  const selectedProfile = cliProfile || fileConfig.profile || DEFAULT_PROFILE;
  const profileDefaults = getProfileDefaults(selectedProfile);

  const effectiveRules = {
    ...profileDefaults,
    ...(isCliProfileExplicit ? {} : fileConfig.rules)
  };

  return {
    source: fileConfig.source,
    profile: selectedProfile,
    rules: effectiveRules,
    overrides: fileConfig.overrides || [],
    raw: fileConfig.raw || {},
    stage: fileConfig.raw?.stage || 'strict'
  };
};

export {
  PROFILES,
  DEFAULT_PROFILE,
  getProfileDefaults,
  findAndLoadConfigFile,
  STRICT_MOLECULE_LINE_LIMIT,
  DEFAULT_MOLECULE_LINE_LIMIT,
  FILE_LINE_LIMIT,
  isFileLengthEnforced,
  resolveMoleculeLineLimit,
  resolveEffectiveMoleculeLineLimit
};
export default loadProjectConfig;
