import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isStdoutTty } from './terminal.js';
import { isNonInteractiveSession } from './audit/rules-predicates.js';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const TTY_OWNER = path.join(CLI_DIR, 'terminal.js');

const listRuntimeSources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  const isSupportDir = entry.isDirectory() && entry.name === 'spec-support';
  if (isSupportDir) return [];
  if (entry.isDirectory()) return listRuntimeSources(full);
  const isRuntimeJs = entry.name.endsWith('.js') && !entry.name.endsWith('.spec.js');
  return isRuntimeJs ? [full] : [];
});

test('tty policy: only cli/terminal.js reads isTTY; every other module asks its helpers', () => {
  const offenders = [];
  for (const file of listRuntimeSources(CLI_DIR)) {
    const isOwner = file === TTY_OWNER;
    if (isOwner) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      const readsIsTty = /\.isTTY\b/.test(line);
      if (readsIsTty) offenders.push(`${path.relative(CLI_DIR, file)}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepStrictEqual(offenders, [], `route these through isStdoutTty/isStdinTty/isInteractive:\n${offenders.join('\n')}`);
});

test('tty policy: a piped stdout makes the audit session non-interactive', () => {
  const isPiped = !isStdoutTty();
  assert.strictEqual(isNonInteractiveSession([], {}), isPiped);
});
