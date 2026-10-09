import { PROFILES, DEFAULT_PROFILE, getProfileDefaults } from './profiles.js';
import { findAndLoadConfigFile } from './loader.js';

// Accepts both `--profile=<name>` and `--profile <name>`.
const parseCliProfile = (rawArgs = []) => {
  const args = rawArgs.map(String);
  const inlineArg = args.find((arg) => arg.startsWith('--profile='));
  const spacedIndex = args.indexOf('--profile');
  const value = inlineArg ? inlineArg.slice('--profile='.length) : args[spacedIndex + 1];
  const hasValue = (Boolean(inlineArg) || spacedIndex !== -1) && typeof value === 'string';
  return hasValue ? value.trim().toLowerCase() || null : null;
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

export { PROFILES, DEFAULT_PROFILE, getProfileDefaults, findAndLoadConfigFile };
export default loadProjectConfig;
