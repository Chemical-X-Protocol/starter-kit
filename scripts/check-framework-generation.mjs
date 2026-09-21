#!/usr/bin/env node

/**
 * Pre-Publish CI Gate: Framework Generation & Semantic Type-Check
 * Ensures generated capsules for React, Vue, and Svelte compile and type-check cleanly.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { runGenerateWizard } from '../cli/generator.js';
import { auditFile } from '../cli/audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const AMBIENT_FRAMEWORK_DECLARATIONS = `
declare module 'vue' {
  export interface Ref<T = any> { value: T; }
  export interface ComputedRef<T = any> { readonly value: T; }
  export function ref<T>(val: T): Ref<T>;
  export function ref<T = any>(): Ref<T | undefined>;
  export function computed<T>(getter: () => T): ComputedRef<T>;
}

declare function $state<T>(initial: T): T;
declare namespace $derived {
  function by<T>(fn: () => T): T;
}
declare function $derived<T>(expr: T): T;
declare function $props(): any;
`;

const parseControllerReturns = (controllerCode) => {
  const returnMatch = controllerCode.match(/return\s*\{([\s\S]*?)\};?/);
  if (!returnMatch) return new Set();
  const returnBody = returnMatch[1];
  const keys = new Set();
  const entries = returnBody.split(/,\s*(?![^{}]*\})/);
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const getterMatch = trimmed.match(/^get\s+([a-zA-Z0-9_]+)\s*\(/);
    if (getterMatch) {
      keys.add(getterMatch[1]);
      continue;
    }
    const keyMatch = trimmed.match(/^([a-zA-Z0-9_]+)/);
    if (keyMatch) {
      keys.add(keyMatch[1]);
    }
  }
  return keys;
};

const parseViewDestructured = (viewCode) => {
  const destructuredKeys = new Set();
  const matches = viewCode.matchAll(
    /(?:const|let)\s*\{([\s\S]*?)\}\s*=\s*(?:\{[^}]*\}\s*,\s*|\{\s*\.\.\.props\s*,\s*\.\.\.)?(?:use|create)[A-Z0-9]\w*Controller/g
  );
  for (const match of matches) {
    const keysStr = match[1];
    const rawKeys = keysStr.split(',').map((k) => k.trim()).filter(Boolean);
    for (const rawKey of rawKeys) {
      const cleanKey = rawKey.split(':')[0].trim();
      if (cleanKey && !cleanKey.startsWith('...')) {
        destructuredKeys.add(cleanKey);
      }
    }
  }
  return destructuredKeys;
};

export const runFrameworkPrePublishGate = async () => {
  process.stdout.write('🔍 Running Chemical X Pre-Publish Framework Generation Gate...\n');

  const frameworks = ['react', 'vue', 'svelte'];
  const testDesc = 'add, toggle, and remove tasks with an input field';
  const scratchDir = path.resolve(ROOT_DIR, 'scratch/pre-publish-gate');

  if (fs.existsSync(scratchDir)) {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
  fs.mkdirSync(scratchDir, { recursive: true });

  const ambientDtsPath = path.join(scratchDir, 'ambient.d.ts');
  fs.writeFileSync(ambientDtsPath, AMBIENT_FRAMEWORK_DECLARATIONS, 'utf-8');

  let hasErrors = false;

  for (const fw of frameworks) {
    const targetDir = path.join(scratchDir, fw);
    const res = await runGenerateWizard([
      'molecule',
      'task-list',
      '-y',
      `--dir=${targetDir}`,
      `--framework=${fw}`,
      `--desc=${testDesc}`
    ]);

    if (!res?.success) {
      process.stderr.write(`  \x1b[31m✕ [${fw}] Failed to scaffold capsule\x1b[0m\n`);
      hasErrors = true;
      continue;
    }

    const capsuleDir = path.join(targetDir, 'm-task-list');
    const ext = fw === 'react' ? 'tsx' : fw;
    const viewPath = path.join(capsuleDir, `m-task-list.${ext}`);
    const controllerPath = path.join(capsuleDir, 'm-task-list.controller.ts');

    if (!fs.existsSync(viewPath) || !fs.existsSync(controllerPath)) {
      process.stderr.write(`  \x1b[31m✕ [${fw}] Missing view or controller file on disk\x1b[0m\n`);
      hasErrors = true;
      continue;
    }

    const viewContent = fs.readFileSync(viewPath, 'utf-8');
    const controllerContent = fs.readFileSync(controllerPath, 'utf-8');

    // 1. Return-shape diff
    const returnedKeys = parseControllerReturns(controllerContent);
    const destructuredKeys = parseViewDestructured(viewContent);
    const missingKeys = [];
    for (const k of destructuredKeys) {
      if (!returnedKeys.has(k)) missingKeys.push(k);
    }
    if (missingKeys.length > 0) {
      process.stderr.write(`  \x1b[31m✕ [${fw}] Return-shape diff failed: view references undefined exports [${missingKeys.join(', ')}]\x1b[0m\n`);
      hasErrors = true;
    }

    // 2. Prohibited anti-patterns (method collision)
    if (controllerContent.includes('.filter.value')) {
      process.stderr.write(`  \x1b[31m✕ [${fw}] Detected invalid .filter.value collision in controller\x1b[0m\n`);
      hasErrors = true;
    }

    // 3. Semantic TypeScript compilation
    const tsProgram = ts.createProgram([ambientDtsPath, controllerPath], {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext
    });

    const diagnostics = ts.getPreEmitDiagnostics(tsProgram).filter(
      (d) => d.file && d.file.fileName === controllerPath
    );

    if (diagnostics.length > 0) {
      process.stderr.write(`  \x1b[31m✕ [${fw}] TypeScript type-check failed with ${diagnostics.length} error(s):\x1b[0m\n`);
      for (const diag of diagnostics) {
        const lineChar = diag.file && diag.start !== undefined ? diag.file.getLineAndCharacterOfPosition(diag.start) : { line: 0, character: 0 };
        const msg = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
        process.stderr.write(`     line ${lineChar.line + 1}: ${msg}\n`);
      }
      hasErrors = true;
    } else {
      process.stdout.write(`  \x1b[32m✔\x1b[0m [${fw}] Clean return-shape contract and 0 TypeScript errors\n`);
    }

    // 4. Audit check
    const auditViolations = auditFile(viewPath, `m-task-list.${ext}`);
    const mismatches = auditViolations.filter((v) => v.rule === 'CONTROLLER_VIEW_MISMATCH');
    if (mismatches.length > 0) {
      process.stderr.write(`  \x1b[31m✕ [${fw}] Audit flagged CONTROLLER_VIEW_MISMATCH\x1b[0m\n`);
      hasErrors = true;
    }
  }

  // Cleanup
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {}

  if (hasErrors) {
    process.stderr.write('\n\x1b[31m✕ Pre-publish framework gate FAILED. Publish aborted.\x1b[0m\n');
    process.exit(1);
  }

  process.stdout.write('\x1b[32m✔ Pre-publish framework gate passed for all frameworks.\x1b[0m\n');
};

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  runFrameworkPrePublishGate().catch((err) => {
    process.stderr.write(`Fatal error in pre-publish gate: ${err.message}\n`);
    process.exit(1);
  });
}
