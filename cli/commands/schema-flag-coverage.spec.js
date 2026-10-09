/**
 * Guards #4504: every long flag a cmd-<name>.js handler names must be listed in that command's
 * schema entry, or the unknown-flag rejection (#2583) refuses a flag the handler really reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCommandSchema } from '../commands-schema.js';
import { knownLongFlags, PASSTHROUGH_COMMANDS, findUnknownFlag } from './unknown-flags.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const GLOBAL = new Set(['--help', '--version', '--project-root', '--root', '--as']);
const handlers = fs.readdirSync(dir).filter((f) => /^cmd-.+\.js$/.test(f) && !f.includes('.spec'));

test('handler flags are all listed in the schema entry', () => {
  const gaps = [];
  for (const file of handlers) {
    const entry = findCommandSchema(file.slice(4, -3));
    const isChecked = entry && !Object.hasOwn(PASSTHROUGH_COMMANDS, entry.name);
    if (!isChecked) continue;
    const known = knownLongFlags(entry);
    const used = fs.readFileSync(path.join(dir, file), 'utf8').match(/['"`](--[a-z][a-z0-9-]*)/g) ?? [];
    for (const raw of new Set(used.map((s) => s.slice(1)))) {
      const isListed = known.has(raw) || GLOBAL.has(raw);
      if (!isListed) gaps.push(`${entry.name} ${raw}`);
    }
  }
  assert.deepEqual(gaps, []);
});

test('check accepts --profile, --json and --compact', () => {
  assert.equal(findUnknownFlag('check', ['check', 'a.vue', '--profile=atomic-strict', '--json', '--compact']), null);
  assert.equal(findUnknownFlag('check', ['check', 'a.vue', '--profile', 'atomic-strict']), null);
});
