import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RULE_REGISTRY } from './rules-registry.js';

const KIT_ROOT = new URL('../../', import.meta.url);
const DIRECTIVE_REF = /Directive (\d+)\.([A-Z])\b/g;

const parseAgentsHeadings = () => {
  const agents = fs.readFileSync(new URL('AGENTS.md', KIT_ROOT), 'utf-8');
  const headings = new Set();
  let section = null;
  for (const line of agents.split('\n')) {
    const sectionMatch = /^## (\d+)\./.exec(line);
    if (sectionMatch) section = sectionMatch[1];
    const subMatch = /^### ([A-Z])\./.exec(line);
    if (subMatch && section) headings.add(`${section}.${subMatch[1]}`);
  }
  return headings;
};

const listSourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return listSourceFiles(full);
  const isSource = entry.name.endsWith('.js') && !entry.name.endsWith('.spec.js');
  return isSource ? [full] : [];
});

test('every rule directive reference points at a real AGENTS.md directive', () => {
  const headings = parseAgentsHeadings();
  const missing = [];
  for (const [rule, meta] of Object.entries(RULE_REGISTRY)) {
    for (const [, section, letter] of meta.directive.matchAll(DIRECTIVE_REF)) {
      const ref = `${section}.${letter}`;
      if (!headings.has(ref)) missing.push(`${rule} -> ${ref}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every Directive X.Y cited in audit and CLI source exists in AGENTS.md', () => {
  const headings = parseAgentsHeadings();
  const cliDir = new URL('../', import.meta.url).pathname;
  const missing = [];
  for (const file of listSourceFiles(cliDir)) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const [, section, letter] of text.matchAll(DIRECTIVE_REF)) {
      const ref = `${section}.${letter}`;
      if (!headings.has(ref)) missing.push(`${path.relative(cliDir, file)} -> ${ref}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});
