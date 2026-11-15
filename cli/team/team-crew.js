/**
 * `chemx team crew import [roster.json] [--dry-run] [--json]`: a StarNet crew roster becomes stable agent
 * handles on this board (#7634), so tasks can stay with @chemist instead of a one-off session handle.
 * Reads only agentId, name, role, model and provider from each entry; never the system prompt.
 * Re-running updates the same handles: an agent already imported keeps its handle, matched by StarNet agentId.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerAgent } from './team-db-agents.js';

const USAGE = 'Usage: chemx team crew import [roster.json] [--dry-run] [--json]\n  Default roster: $STARNET_WORKSPACES, then the StarNet app-data workspaces (agent.roster.json).\n';

/** Candidate roster files, newest first among those that exist. */
export const rosterCandidates = (env = process.env, home = os.homedir()) => {
  const dirs = [
    env.STARNET_WORKSPACES,
    path.join(home, '.local', 'share', 'ai.skynet.harness', 'workspaces'),
    path.join(home, '.local', 'share', 'StarNet', 'workspaces'),
    path.join(home, 'Library', 'Application Support', 'ai.skynet.harness', 'workspaces')
  ].filter(Boolean);
  const files = dirs.map((d) => path.join(d, 'agent.roster.json')).filter((f) => fs.existsSync(f));
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
};

// A leading card badge ('♥Q', '♦K', '♠♂'): the first word, when it holds a card suit.
const CARD_BADGE = /^\S*[♠♣♥♦♤♧♡♢]\S*\s+/u;

/** '♥♂ CHEMIST' -> '@chemist'; '♥Q CHIEF OF STAFF' -> '@chief-of-staff'. Empty when no letters or digits remain. */
export const crewHandle = (name) => {
  const bare = String(name || '').trim().replace(CARD_BADGE, '');
  const slug = bare.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? `@${slug}` : '';
};

/** The dispatch tier a model fits: haiku light, opus deep, anything else standard. */
export const crewTier = (model) => {
  const id = String(model || '').toLowerCase();
  if (id.includes('haiku')) return 'light';
  if (id.includes('opus')) return 'deep';
  return 'standard';
};

const rosterEntries = (raw) => {
  const list = Array.isArray(raw) ? raw : raw?.agents || raw?.roster || [];
  return list.filter((a) => a && typeof a === 'object' && (a.agentId || a.name));
};

const importedHandles = (db) => {
  const byStarnetId = new Map();
  for (const row of db.prepare('SELECT id, metadata FROM agents').all()) {
    let meta = {};
    try { meta = JSON.parse(row.metadata || '{}') || {}; } catch { meta = {}; } // chemx-allow: a malformed metadata row is treated as not imported
    const isImported = meta.source === 'starnet' && Boolean(meta.starnetAgentId);
    if (isImported) byStarnetId.set(meta.starnetAgentId, row.id);
  }
  return byStarnetId;
};

/** Plans (and unless dryRun, writes) one agent row per roster entry. Returns { crew, skipped }. */
export const importCrew = (db, roster, { dryRun = false, source = '' } = {}) => {
  const known = importedHandles(db);
  const taken = new Set(known.values());
  const crew = [];
  const skipped = [];
  for (const entry of rosterEntries(roster)) {
    const previous = entry.agentId ? known.get(entry.agentId) : '';
    const base = previous || crewHandle(entry.name);
    if (!base) { skipped.push({ name: entry.name || '', reason: 'name has no letters or digits' }); continue; }
    let handle = base;
    for (let n = 2; !previous && taken.has(handle); n++) handle = `${base}-${n}`;
    taken.add(handle);
    const tier = crewTier(entry.model);
    const row = {
      id: handle, name: String(entry.name || handle).trim(), role: String(entry.role || 'crew').trim(), tier,
      capabilities: ['crew', `tier:${tier}`],
      metadata: { source: 'starnet', starnetAgentId: entry.agentId || null, model: entry.model || null, provider: entry.provider || null, roster: source || null }
    };
    if (!dryRun) registerAgent(db, row);
    crew.push({ handle, name: row.name, role: row.role, tier, model: row.metadata.model, isNew: !previous });
  }
  return { crew, skipped };
};

/** Crew handles on the board for a tier (all tiers when tier is empty), oldest import order kept by name. */
export const listCrew = (db, tier = '') => db.prepare('SELECT id, name, role, capabilities, metadata FROM agents').all()
  .filter((row) => String(row.capabilities || '').includes('"crew"'))
  .filter((row) => !tier || String(row.capabilities).includes(`"tier:${tier}"`))
  .map((row) => ({ handle: row.id, name: row.name, role: row.role }))
  .sort((a, b) => a.handle.localeCompare(b.handle));

const formatCrew = ({ crew, skipped }, rosterPath, dryRun) => {
  const head = `${dryRun ? 'Would import' : 'Imported'} ${crew.length} crew member(s) from ${rosterPath}`;
  const rows = crew.map((c) => `  ${c.handle.padEnd(22)} ${c.tier.padEnd(9)} ${c.isNew ? 'new    ' : 'updated'} ${c.name} (${c.role})`);
  const skips = skipped.map((s) => `  skipped "${s.name}": ${s.reason}`);
  return [head, ...rows, ...skips].join('\n') + '\n';
};

export const handleCrewCommand = (db, positionals, rawArgs, flags, isCli) => {
  const [action = 'list', file] = positionals;
  const write = (text) => { if (isCli) process.stdout.write(text); };
  if (flags.help) { write(USAGE); return { help: true }; }
  const isList = action === 'list';
  if (isList) {
    const crew = listCrew(db);
    write(flags.isJson ? `${JSON.stringify(crew)}\n` : (crew.map((c) => `${c.handle}  ${c.name} (${c.role})`).join('\n') || 'No crew imported: chemx team crew import') + '\n');
    return { crew };
  }
  const isImport = action === 'import';
  if (!isImport) { write(USAGE); return { error: `Unknown crew action: ${action}` }; }
  const rosterPath = file || rosterCandidates()[0];
  const hasRoster = Boolean(rosterPath) && fs.existsSync(rosterPath);
  if (!hasRoster) {
    write(`✕ No StarNet roster found${file ? ` at ${file}` : ''}. Pass the path to agent.roster.json.\n`);
    return { error: 'roster not found' };
  }
  let roster;
  try { roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8')); } catch (err) {
    write(`✕ ${rosterPath} is not valid JSON: ${err.message}\n`);
    return { error: 'roster not JSON' };
  }
  const dryRun = rawArgs.includes('--dry-run');
  const result = importCrew(db, roster, { dryRun, source: rosterPath });
  write(flags.isJson ? `${JSON.stringify({ roster: rosterPath, dryRun, ...result })}\n` : formatCrew(result, rosterPath, dryRun));
  return { roster: rosterPath, dryRun, ...result };
};
