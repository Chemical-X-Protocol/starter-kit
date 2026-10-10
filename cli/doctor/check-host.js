// Doctor checks for the Claude host: chemx hooks installed (and pointing at an existing entry, not the
// bootstrap guard) and generated host shims (CLAUDE.md, .cursorrules, llms.txt) matching the generator.

import fs from 'node:fs';
import path from 'node:path';
import { STATUS } from '../result-status.js';
import { isChemxHookCommand, mergeClaudeSettings } from '../hooks/claude-settings-merge.js';
import { KIT_ROOT, resolveLauncher } from '../hooks/launcher.js';
import { HOST_SHIM_FILES, buildHostShims } from '../host-shims.js';
import { GENERATED_MARKERS } from '../pillars-write-guard.js';
import { PILLARS } from '../pillars-schema.js';
import { readJsonOr } from '../fs-json.js';

const EVENTS = ['PreToolUse', 'PostToolUse', 'SessionStart'];
const SCOPE_FILES = [
  { scope: 'project', file: path.join('.claude', 'settings.json') },
  { scope: 'local', file: path.join('.claude', 'settings.local.json') },
];
const SETTINGS = SCOPE_FILES.map(({ file }) => file);
const INSTALLED_ENTRY = /cli\/hooks\/entry\.js/;
const BOOTSTRAP_PATH = /([^\s"']*chemx-guard\.mjs)/;

const readJsonOrEmpty = (file) => {
  // missing or unparseable settings count as "no hooks"; install-hooks reports parse errors
  return readJsonOr(file, {});
};

const entryPathOf = (command, projectRoot) => {
  const match = String(command).match(/node\s+"?([^"\s]+entry\.js)"?/);
  return match ? match[1].replace('$CLAUDE_PROJECT_DIR', projectRoot) : null;
};

// The bootstrap guard counts as current when the file hands every call to the chemx hook command.
const isDelegatingBootstrap = (command, projectRoot) => {
  const found = String(command).match(BOOTSTRAP_PATH);
  if (!found) return false;
  const file = path.resolve(projectRoot, found[1].replace('$CLAUDE_PROJECT_DIR', projectRoot));
  try {
    return /claude-pre-tool/.test(fs.readFileSync(file, 'utf-8'));
  } catch {
    return false; // a missing bootstrap file cannot delegate
  }
};

const ownedCommandsOf = (settings) => Object.values(settings.hooks ?? {})
  .flatMap((groups) => (Array.isArray(groups) ? groups : []))
  .flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks : []))
  .map((hook) => hook?.command)
  .filter(isChemxHookCommand);

const hasInstalledEntry = (projectRoot, file) => ownedCommandsOf(readJsonOrEmpty(path.join(projectRoot, file))).some((command) => INSTALLED_ENTRY.test(command));

// Where chemx-owned entries (installed or the bootstrap guard) live now, project first, so a repair
// rewrites that file in place; project when there are none yet.
const holdsOwnedEntry = (projectRoot, file) => ownedCommandsOf(readJsonOrEmpty(path.join(projectRoot, file))).length > 0;
const installedScopeOf = (projectRoot) => SCOPE_FILES.find(({ file }) => holdsOwnedEntry(projectRoot, file))?.scope ?? 'project';

// Settings files whose installed chemx entries differ from what this chemx would install now.
const findOutdated = ({ projectRoot, kitRoot }) => SCOPE_FILES.flatMap(({ scope, file }) => {
  const settings = readJsonOrEmpty(path.join(projectRoot, file));
  const isInstalled = hasInstalledEntry(projectRoot, file);
  if (!isInstalled) return [];
  const merged = mergeClaudeSettings(settings, resolveLauncher({ kitRoot, projectRoot, scope }), { statusline: false });
  const isCurrent = !merged.ok || merged.isUnchanged;
  return isCurrent ? [] : [{ scope, file, changes: merged.changes }];
});

export const checkHooks = ({ projectRoot, kitRoot = KIT_ROOT }) => {
  const commands = SETTINGS.flatMap((rel) => {
    const hooks = readJsonOrEmpty(path.join(projectRoot, rel)).hooks ?? {};
    return EVENTS.map((event) => ({ event, list: (hooks[event] ?? []).flatMap((group) => (group.hooks ?? []).map((hook) => hook.command)) }));
  });
  const owned = (event) => commands.filter((entry) => entry.event === event).flatMap((entry) => entry.list).filter(isChemxHookCommand);
  const missing = EVENTS.filter((event) => owned(event).length === 0);
  const allOwned = EVENTS.flatMap(owned);
  const legacy = allOwned.filter((command) => /chemx-guard\.mjs/.test(command) && !isDelegatingBootstrap(command, projectRoot));
  const outdated = findOutdated({ projectRoot, kitRoot });
  const dangling = allOwned.map((command) => entryPathOf(command, projectRoot)).filter((entry) => entry && !fs.existsSync(entry));
  const problems = [];
  const hasMissing = missing.length > 0;
  if (hasMissing) problems.push(`missing: ${missing.join(', ')}`);
  const hasLegacy = legacy.length > 0;
  if (hasLegacy) problems.push('bootstrap chemx-guard.mjs still installed');
  const hasDangling = dangling.length > 0;
  if (hasDangling) problems.push(`entry not found: ${dangling[0]}`);
  for (const entry of outdated) problems.push(`outdated in ${entry.file} (differs from this chemx): ${entry.changes.join(' / ')}`);
  const isHealthy = problems.length === 0;
  const scope = outdated[0]?.scope ?? installedScopeOf(projectRoot);
  return { id: 'hooks', status: isHealthy ? STATUS.PASS : STATUS.FAIL, summary: isHealthy ? 'chemx hooks installed for PreToolUse, PostToolUse, SessionStart' : problems.join('; '), fixable: !isHealthy, scope };
};

const pillarIdsFromShim = (text) => {
  const line = text.split('\n').find((row) => row.startsWith('Active pillars:')) ?? '';
  const titles = line.replace(/^Active pillars:\s*/, '').replace(/\.$/, '').split(', ');
  return PILLARS.filter((pillar) => titles.includes(pillar.title.replace(/^Pillar \d+:\s*/, ''))).map((pillar) => pillar.id);
};

export const checkShims = ({ projectRoot }) => {
  const present = HOST_SHIM_FILES.filter((name) => fs.existsSync(path.join(projectRoot, name)));
  const generated = present.filter((name) => {
    const text = fs.readFileSync(path.join(projectRoot, name), 'utf-8');
    return text.includes(GENERATED_MARKERS.md) || text.includes(GENERATED_MARKERS.rules);
  });
  const drifted = generated.filter((name) => {
    const text = fs.readFileSync(path.join(projectRoot, name), 'utf-8');
    const projectName = name === 'llms.txt' ? (text.match(/^# (.+)$/m)?.[1] ?? 'Project') : 'Project';
    return buildHostShims(pillarIdsFromShim(text), { projectName })[name] !== text;
  });
  const handWritten = present.filter((name) => !generated.includes(name));
  const hasNone = generated.length === 0;
  if (hasNone) return { id: 'shims', status: STATUS.INCONCLUSIVE, summary: `no generated host shims${handWritten.length ? ` (hand-written: ${handWritten.join(', ')})` : ''}` };
  const isClean = drifted.length === 0;
  const summary = isClean ? `generated shims current: ${generated.join(', ')}` : `drift in ${drifted.join(', ')}: run chemx pillars --write`;
  return { id: 'shims', status: isClean ? STATUS.PASS : STATUS.FAIL, summary };
};
