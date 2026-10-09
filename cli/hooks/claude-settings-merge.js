// Pure merge of chemx hooks into a Claude Code settings object. chemx-owned entries (including the
// COMPASS bootstrap guard) are replaced in place; foreign entries are never modified or reordered.

const OWNED_COMMAND = /cli\/hooks\/entry\.js|chemx-guard\.mjs|\b(?:chemx|cx)\s+hook\b/;

export const isChemxHookCommand = (command) => OWNED_COMMAND.test(String(command ?? ''));

export const PRE_TOOL_MATCHER = 'Bash|Grep|Read|Edit|Write|MultiEdit|NotebookEdit|Glob';
export const POST_EDIT_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';

export const desiredClaudeHooks = (launcher) => ({
  PreToolUse: { matcher: PRE_TOOL_MATCHER, hooks: [{ type: 'command', command: launcher.hookCommand('claude-pre-tool'), timeout: 10 }] },
  PostToolUse: { matcher: POST_EDIT_MATCHER, hooks: [{ type: 'command', command: launcher.hookCommand('claude-post-edit'), timeout: 30 }] },
  SessionStart: { hooks: [{ type: 'command', command: launcher.hookCommand('session-start'), timeout: 10 }] },
});

const desiredStatusLine = (launcher) => ({ type: 'command', command: launcher.hookCommand('statusline'), padding: 0 });

// Remove chemx hooks from every group; drop groups left empty. Returns the index of the first group
// that held a chemx hook, so the replacement lands where the old one was.
const withoutOwnedHooks = (groups) => {
  let firstOwnedIndex = -1;
  const kept = [];
  for (const group of groups) {
    const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
    const foreign = hooks.filter((hook) => !isChemxHookCommand(hook?.command));
    const hadOwned = foreign.length !== hooks.length;
    const isFirstOwned = hadOwned && firstOwnedIndex === -1;
    if (isFirstOwned) firstOwnedIndex = kept.length;
    const isEmptied = hadOwned && foreign.length === 0;
    if (isEmptied) continue;
    kept.push(hadOwned ? { ...group, hooks: foreign } : group);
  }
  return { kept, firstOwnedIndex };
};

const mergeEvent = (groups, desiredGroup) => {
  const { kept, firstOwnedIndex } = withoutOwnedHooks(groups);
  const insertAt = firstOwnedIndex === -1 ? kept.length : firstOwnedIndex;
  return [...kept.slice(0, insertAt), desiredGroup, ...kept.slice(insertAt)];
};

const mergeStatusLine = (current, launcher, notes) => {
  const desired = desiredStatusLine(launcher);
  const hasStatusLine = current !== undefined && current !== null;
  const isForeign = hasStatusLine && !isChemxHookCommand(current.command);
  if (isForeign) {
    notes.refusals.push(`statusLine: kept the existing foreign statusLine (${String(current.command).slice(0, 60)})`);
    return current;
  }
  return desired;
};

export const mergeClaudeSettings = (existing, launcher, { statusline = true } = {}) => {
  const isObject = existing !== null && typeof existing === 'object' && !Array.isArray(existing);
  if (!isObject) return { ok: false, error: 'settings file is not a JSON object' };
  const hasHooksObject = existing.hooks === undefined || (typeof existing.hooks === 'object' && !Array.isArray(existing.hooks));
  if (!hasHooksObject) return { ok: false, error: '"hooks" is not an object' };
  const notes = { refusals: [] };
  const hooks = { ...(existing.hooks ?? {}) };
  for (const [event, desiredGroup] of Object.entries(desiredClaudeHooks(launcher))) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    hooks[event] = mergeEvent(groups, desiredGroup);
  }
  const settings = { ...existing, hooks };
  if (statusline) settings.statusLine = mergeStatusLine(existing.statusLine, launcher, notes);
  const isUnchanged = JSON.stringify(settings) === JSON.stringify(existing);
  return { ok: true, settings, isUnchanged, refusals: notes.refusals };
};
