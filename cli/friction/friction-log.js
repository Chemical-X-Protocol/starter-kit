// Machine friction log: one JSON object per line in <root>/.chemx/friction.jsonl.
// Hooks append guard denials and bypasses here automatically; `chemx friction` reads it back.
// Appends are best effort: a hook must never fail a tool call because the log is unwritable.

import fs from 'node:fs';
import path from 'node:path';

export const FRICTION_FILE = path.join('.chemx', 'friction.jsonl');
const COMMAND_LIMIT = 240;

export const resolveFrictionPath = (root, env = process.env) => env.CHEMX_FRICTION_LOG || path.join(root, FRICTION_FILE);

export const toFrictionEntry = (fields, now = Date.now()) => {
  const entry = { ts: new Date(now).toISOString(), ...fields };
  const hasCommand = typeof entry.command === 'string';
  if (hasCommand) entry.command = entry.command.slice(0, COMMAND_LIMIT);
  return entry;
};

export const appendFriction = (root, fields, env = process.env) => {
  const file = resolveFrictionPath(root, env);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(toFrictionEntry(fields))}\n`, 'utf-8');
    return { ok: true, file };
  } catch (error) {
    return { ok: false, file, error: error instanceof Error ? error.message : String(error) };
  }
};

const parseLine = (line) => {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch (error) {
    return { ok: false, error };
  }
};

export const readFriction = (root, env = process.env) => {
  const file = resolveFrictionPath(root, env);
  const hasLog = fs.existsSync(file);
  if (!hasLog) return { file, entries: [], malformed: 0 };
  const entries = [];
  let malformed = 0;
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const isBlank = line.trim() === '';
    if (isBlank) continue;
    const parsed = parseLine(line);
    if (parsed.ok) entries.push(parsed.value);
    else malformed += 1;
  }
  return { file, entries, malformed };
};
