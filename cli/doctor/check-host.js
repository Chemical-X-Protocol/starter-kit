// Doctor checks for the Claude host: chemx hooks installed (and pointing at an existing entry, not the
// bootstrap guard) and generated host shims (CLAUDE.md, .cursorrules, llms.txt) matching the generator.

import fs from 'node:fs';
import path from 'node:path';
import { STATUS } from '../result-status.js';
import { isChemxHookCommand } from '../hooks/claude-settings-merge.js';
import { HOST_SHIM_FILES, buildHostShims } from '../host-shims.js';
import { GENERATED_MARKERS } from '../pillars-write-guard.js';
import { PILLARS } from '../pillars-schema.js';

const EVENTS = ['PreToolUse', 'PostToolUse', 'SessionStart'];
const SETTINGS = [path.join('.claude', 'settings.local.json'), path.join('.claude', 'settings.json')];

const readJsonOrEmpty = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {}; // missing or unparseable settings count as "no hooks"; install-hooks reports parse errors
  }
};

const entryPathOf = (command, projectRoot) => {
  const match = String(command).match(/node\s+"?([^"\s]+entry\.js)"?/);
  return match ? match[1].replace('$CLAUDE_PROJECT_DIR', projectRoot) : null;
};

export const checkHooks = ({ projectRoot }) => {
  const commands = SETTINGS.flatMap((rel) => {
    const hooks = readJsonOrEmpty(path.join(projectRoot, rel)).hooks ?? {};
    return EVENTS.map((event) => ({ event, list: (hooks[event] ?? []).flatMap((group) => (group.hooks ?? []).map((hook) => hook.command)) }));
  });
  const owned = (event) => commands.filter((entry) => entry.event === event).flatMap((entry) => entry.list).filter(isChemxHookCommand);
  const missing = EVENTS.filter((event) => owned(event).length === 0);
  const allOwned = EVENTS.flatMap(owned);
  const legacy = allOwned.filter((command) => /chemx-guard\.mjs/.test(command));
  const dangling = allOwned.map((command) => entryPathOf(command, projectRoot)).filter((entry) => entry && !fs.existsSync(entry));
  const problems = [];
  if (missing.length > 0) problems.push(`missing: ${missing.join(', ')}`);
  if (legacy.length > 0) problems.push('bootstrap chemx-guard.mjs still installed');
  if (dangling.length > 0) problems.push(`entry not found: ${dangling[0]}`);
  const isHealthy = problems.length === 0;
  return { id: 'hooks', status: isHealthy ? STATUS.PASS : STATUS.FAIL, summary: isHealthy ? 'chemx hooks installed for PreToolUse, PostToolUse, SessionStart' : problems.join('; '), fixable: !isHealthy };
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
