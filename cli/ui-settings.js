/**
 * Settings page API (#7653, #7654, #7655).
 *   GET  /api/settings          board, UI server, crew, dispatch routing and the editable .chemxrc keys with defaults
 *   POST /api/settings          { key, value } for one allowlisted key; keeps every other key; refuses a file with comments
 *   POST /api/crew/import       runs `chemx team crew import` on the default StarNet roster
 * The .chemxrc written is the one chemx reads from the UI server's directory (cwd), created when missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { findAndLoadConfigFile, stripJsonComments } from './config/loader.js';
import { PROFILES, DEFAULT_PROFILE } from './config/profiles.js';
import { routeModel, loadModelRouting } from './team/team-dispatch.js';
import { rosterCandidates, importCrew, listCrew } from './team/team-crew.js';
import { skipOpenReason } from './ui-open.js';

/** Editable keys: path in .chemxrc, default, and the check a new value must pass. */
export const SETTINGS = {
  profile: { path: ['profile'], fallback: DEFAULT_PROFILE, check: (v) => Object.hasOwn(PROFILES, v) },
  nativeFileTools: { path: ['nativeFileTools'], fallback: 'warn', check: (v) => ['block', 'warn', 'allow'].includes(v) },
  guardNudges: { path: ['guardNudges'], fallback: 'nudge', check: (v) => ['block', 'nudge'].includes(v) },
  'commit.skipCi': { path: ['commit', 'skipCi'], fallback: false, check: (v) => typeof v === 'boolean' },
  'commit.coAuthor': { path: ['commit', 'coAuthor'], fallback: '', check: (v) => typeof v === 'string' && v.length <= 200 && !/[\r\n]/.test(v) }
};

const dig = (obj, keys) => keys.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
const rcPath = (cwd) => findAndLoadConfigFile(cwd).source || path.resolve(cwd, '.chemxrc');
const dbFile = (db) => db.prepare('PRAGMA database_list').all().find((r) => r.name === 'main')?.file || '';

export const readSettings = (db, cwd = process.cwd()) => {
  const config = findAndLoadConfigFile(cwd);
  const values = Object.fromEntries(Object.entries(SETTINGS).map(([key, s]) => {
    const value = dig(config.raw, s.path);
    return [key, { value: value ?? s.fallback, isDefault: value === undefined }];
  }));
  const routing = loadModelRouting(cwd);
  const file = db ? dbFile(db) : '';
  const hasFile = Boolean(file) && fs.existsSync(file);
  return {
    success: true,
    config: { source: config.source, writesTo: rcPath(cwd), values, profiles: Object.entries(PROFILES).map(([id, p]) => ({ id, name: p.name || id })) },
    board: { db: file, sizeBytes: hasFile ? fs.statSync(file).size : null, projectRoot: cwd,
      tasks: db?.prepare('SELECT COUNT(*) AS c FROM agent_tasks').get().c ?? 0, agents: db?.prepare('SELECT COUNT(*) AS c FROM agents').get().c ?? 0 },
    server: { tokenMode: process.env.CHEMX_UI_TOKEN ? 'fixed (CHEMX_UI_TOKEN)' : 'new token each launch', autoOpen: skipOpenReason() || 'on' },
    routing: { source: routing ? '.chemx/config.json modelRouting' : 'defaults', tiers: Object.fromEntries(['light', 'standard', 'deep'].map((t) => [t, routeModel(t, routing)])) },
    crew: { count: db ? listCrew(db).length : 0, roster: rosterCandidates()[0] || '' }
  };
};

export const writeSetting = (cwd, { key, value } = {}) => {
  const setting = SETTINGS[key];
  if (!setting) return { success: false, error: `Not an editable setting: ${key}` };
  const isValid = setting.check(value);
  if (!isValid) return { success: false, error: `Invalid value for ${key}: ${JSON.stringify(value)}` };
  const file = rcPath(cwd);
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}';
  const hasComments = stripJsonComments(raw) !== raw;
  if (hasComments) return { success: false, error: `${file} has comments; edit it by hand so they are kept.` };
  let data;
  try { data = JSON.parse(raw || '{}'); } catch (err) { return { success: false, error: `${file} is not valid JSON: ${err.message}` }; }
  const parent = setting.path.slice(0, -1).reduce((o, k) => (o[k] && typeof o[k] === 'object' ? o[k] : (o[k] = {})), data);
  parent[setting.path[setting.path.length - 1]] = value;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return { success: true, key, value, file };
};

export const importCrewFromUi = (db, rosterFile = rosterCandidates()[0]) => {
  const hasRoster = Boolean(rosterFile) && fs.existsSync(rosterFile);
  if (!hasRoster) return { success: false, error: 'No StarNet roster found (agent.roster.json). Set STARNET_WORKSPACES or run chemx team crew import <path>.' };
  let roster;
  try { roster = JSON.parse(fs.readFileSync(rosterFile, 'utf8')); } catch (err) { return { success: false, error: `${rosterFile} is not valid JSON: ${err.message}` }; }
  return { success: true, roster: rosterFile, ...importCrew(db, roster, { source: rosterFile }) };
};

export const API_DOCS = [{ path: '/api/settings', about: 'Board, UI server, crew, routing and editable .chemxrc keys; POST { key, value } changes one key.' }];
export const getRoutes = (db, params, ctx = {}) => ({ '/api/settings': () => readSettings(db, ctx.cwd) });
export const postRoutes = (db, body, ctx = {}) => ({
  '/api/settings': () => writeSetting(ctx.cwd || process.cwd(), body),
  '/api/crew/import': () => importCrewFromUi(db)
});
