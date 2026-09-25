import fs from 'node:fs';
import path from 'node:path';
import { matchTypeScriptError } from './build/parser-matchers.js';
import { resolvePackageManager, loadLocalPackageJson } from './build/detector.js';

export const parseCommandFromArgs = (args = []) => {
  const dashDashIndex = args.indexOf('--');
  if (dashDashIndex !== -1) {
    const afterDash = args.slice(dashDashIndex + 1).join(' ').trim();
    if (afterDash.length > 0) return afterDash;
  }
  return null;
};

export const detectTypecheckCommand = (customCmd, cwd = process.cwd()) => {
  if (customCmd && customCmd.trim().length > 0) return customCmd.trim();
  const pkg = loadLocalPackageJson(cwd);
  const scripts = (pkg && pkg.scripts) || {};
  const pm = resolvePackageManager(cwd);

  if (scripts.typecheck) return `${pm} run typecheck`;
  if (scripts['type-check']) return `${pm} run type-check`;
  if (scripts['check-types']) return `${pm} run check-types`;
  if (scripts.tsc) return `${pm} run tsc`;

  if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
    return 'npx tsc --noEmit';
  }

  return `${pm} run typecheck`;
};

export const detectTestCommand = (customCmd, cwd = process.cwd()) => {
  if (customCmd && customCmd.trim().length > 0) return customCmd.trim();
  const pkg = loadLocalPackageJson(cwd);
  const scripts = (pkg && pkg.scripts) || {};
  const pm = resolvePackageManager(cwd);

  const isLegitTest = scripts.test && !scripts.test.includes('no test specified');
  if (isLegitTest) return pm === 'yarn' ? 'yarn test' : `${pm} run test`;

  if (fs.existsSync(path.join(cwd, 'vitest.config.ts')) || fs.existsSync(path.join(cwd, 'vitest.config.js'))) {
    return 'npx vitest run';
  }

  return pm === 'yarn' ? 'yarn test' : `${pm} run test`;
};

export const parseTypecheckOutput = (stdout = '', stderr = '') => {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split(/\r?\n/);
  const errors = [];
  const seen = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = matchTypeScriptError(trimmed);
    if (match) {
      const key = `${match.file}:${match.line}:${match.column}:${match.code}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push(match);
      }
    }
  }

  return errors;
};

export const stripAnsi = (str = '') => String(str).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

export const checkNodeModules = (cwd) => {
  const nmPath = path.join(cwd, 'node_modules');
  if (fs.existsSync(nmPath)) return null;
  const pm = resolvePackageManager(cwd);
  return {
    missing: true,
    pm,
    msg: (action) => `Missing node_modules. Please run '${pm} install' before ${action}.`
  };
};

export const parseTestOutput = (stdout = '', stderr = '', exitCode = 0) => {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split(/\r?\n/);

  let totalTests = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let checkmarkPasses = 0;
  let crossmarkFails = 0;

  for (const line of lines) {
    const clean = stripAnsi(line).trim();
    if (!clean) continue;

    if (clean.startsWith('✔')) checkmarkPasses++;
    if (clean.startsWith('✖') || clean.startsWith('FAIL ')) crossmarkFails++;

    const nodeTests = clean.match(/(?:ℹ\s*)?tests\s+(\d+)/);
    if (nodeTests) totalTests = parseInt(nodeTests[1], 10);

    const nodePass = clean.match(/(?:ℹ\s*)?pass\s+(\d+)/);
    if (nodePass) passed = parseInt(nodePass[1], 10);

    const nodeFail = clean.match(/(?:ℹ\s*)?fail\s+(\d+)/);
    if (nodeFail) failed = parseInt(nodeFail[1], 10);

    const nodeSkip = clean.match(/(?:ℹ\s*)?(?:skipped|todo)\s+(\d+)/);
    if (nodeSkip) skipped += parseInt(nodeSkip[1], 10);

    const vitestMatch = clean.match(/Tests\s+(?:(\d+)\s+failed)?(?:,\s*)?(?:(\d+)\s+passed)?\s*\((\d+)\)/);
    if (vitestMatch) {
      if (vitestMatch[1]) failed = parseInt(vitestMatch[1], 10);
      if (vitestMatch[2]) passed = parseInt(vitestMatch[2], 10);
      if (vitestMatch[3]) totalTests = parseInt(vitestMatch[3], 10);
    }
  }

  if (passed === 0 && checkmarkPasses > 0) passed = checkmarkPasses;
  if (failed === 0 && crossmarkFails > 0) failed = crossmarkFails;
  if (totalTests === 0) totalTests = passed + failed;

  const failures = [];
  if (exitCode !== 0 || failed > 0) {
    let currentFailure = null;

    for (const line of lines) {
      const isFailHeader = line.includes('✖') || line.startsWith('FAIL ') || /^\s*not ok\b/.test(line);
      if (isFailHeader) {
        if (currentFailure) failures.push(currentFailure);
        currentFailure = {
          name: line.replace(/[✖]/g, '').trim(),
          details: []
        };
      } else if (currentFailure) {
        const isCleanLine = !line.includes('✔') && !line.includes('ℹ') && !line.includes('ExperimentalWarning');
        if (isCleanLine && line.trim().length > 0) {
          currentFailure.details.push(line.trim());
          if (currentFailure.details.length >= 6) {
            failures.push(currentFailure);
            currentFailure = null;
          }
        }
      }
    }

    if (currentFailure) failures.push(currentFailure);

    if (failures.length === 0 && exitCode !== 0) {
      const errorLines = lines
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.includes('✔') && !l.includes('ExperimentalWarning'))
        .slice(-10);

      failures.push({
        name: 'Test command failed',
        details: errorLines
      });
    }
  }

  return {
    success: exitCode === 0 && failed === 0,
    totalTests,
    passed,
    failed,
    skipped,
    failures
  };
};
