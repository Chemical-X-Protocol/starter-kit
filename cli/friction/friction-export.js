// Summarise the machine friction log and append new entries to a human Markdown friction log, one
// line each. A cursor (.chemx/friction.cursor) remembers the last exported timestamp so repeated
// exports never duplicate lines.

import fs from 'node:fs';
import path from 'node:path';

const CURSOR_FILE = path.join('.chemx', 'friction.cursor');
const LINE_LIMIT = 220;

export const summariseFriction = (entries) => {
  const byKind = {};
  const byRule = {};
  const byReason = {};
  for (const entry of entries) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    if (entry.rule) byRule[entry.rule] = (byRule[entry.rule] ?? 0) + 1;
    if (entry.reason) byReason[entry.reason] = (byReason[entry.reason] ?? 0) + 1;
  }
  return { total: entries.length, byKind, byRule, byReason };
};

export const toMarkdownLine = (entry) => {
  const day = String(entry.ts ?? '').slice(0, 10);
  const subject = entry.command ? ` \`${entry.command.replace(/`/g, "'").replace(/\s+/g, ' ')}\`` : '';
  const detail = [entry.rule, entry.reason ? `reason: ${entry.reason}` : null, entry.note].filter(Boolean).join('; ');
  return `- (auto ${day}) ${entry.kind}${subject}${detail ? `: ${detail}` : ''}`.slice(0, LINE_LIMIT);
};

const readCursor = (root) => {
  const file = path.join(root, CURSOR_FILE);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').trim() : '';
};

export const exportFriction = ({ root, entries, target, dryRun = false }) => {
  const cursor = readCursor(root);
  const fresh = entries.filter((entry) => String(entry.ts ?? '') > cursor);
  const lines = fresh.map(toMarkdownLine);
  const hasFresh = lines.length > 0;
  const shouldWrite = hasFresh && !dryRun;
  if (shouldWrite) {
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : '';
    const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(target, `${separator}${lines.join('\n')}\n`, 'utf-8');
    fs.mkdirSync(path.join(root, '.chemx'), { recursive: true });
    fs.writeFileSync(path.join(root, CURSOR_FILE), String(fresh[fresh.length - 1].ts), 'utf-8');
  }
  return { appended: shouldWrite ? lines.length : 0, pending: lines.length, lines };
};
