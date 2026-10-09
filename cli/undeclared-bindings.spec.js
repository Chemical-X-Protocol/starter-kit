import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Re-exports create no local binding (`export { x } from`), so code that then calls `x` throws a
// ReferenceError only at runtime (q --help did). This scan fails on any undeclared identifier.
const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default?.default || traverseModule.default || traverseModule;

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_GLOBALS = new Set([
  ...Object.getOwnPropertyNames(globalThis), 'process', 'Buffer', 'console', 'URL', 'fetch', 'require', 'module',
  '__dirname', '__filename', 'arguments', 'undefined', 'window', 'document', 'navigator', 'localStorage',
  'EventSource', 'HTMLElement', 'customElements', 'location', 'history', 'requestAnimationFrame', 'alert', 'confirm'
]);

const listSources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  const isTemplateDir = entry.isDirectory() && entry.name === 'generator-templates';
  if (isTemplateDir) return [];
  if (entry.isDirectory()) return listSources(full);
  const isSource = entry.name.endsWith('.js') && !entry.name.endsWith('.spec.js');
  return isSource ? [full] : [];
});

test('cli/ sources reference no undeclared identifiers', () => {
  const offenders = [];
  for (const file of listSources(CLI_DIR)) {
    const ast = parse(fs.readFileSync(file, 'utf-8'), { sourceType: 'module', plugins: ['topLevelAwait'], errorRecovery: true });
    traverse(ast, {
      Program(programPath) {
        for (const name of Object.keys(programPath.scope.globals)) {
          const isKnownGlobal = RUNTIME_GLOBALS.has(name);
          if (!isKnownGlobal) offenders.push(`${path.relative(CLI_DIR, file)}: ${name}`);
        }
      }
    });
  }
  assert.deepEqual(offenders, []);
});
