#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runFrameworkPrePublishGate } from './check-framework-generation.mjs';
import { computePublishExitCode, formatPublishSummary } from './publish-summary.mjs';
import { restoreOnExit } from './package-json-guard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_DIR = path.resolve(__dirname, '..');
const PKG_JSON = path.join(PKG_DIR, 'package.json');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const otpArg = args.find((a) => a.startsWith('--otp='));
const otp = otpArg ? otpArg.split('=')[1] : null;
const readExplicitTag = () => {
  const tagArg = args.find((a) => a.startsWith('--tag='));
  if (tagArg) return tagArg.split('=')[1];
  const tagIndex = args.indexOf('--tag');
  const nextArg = tagIndex === -1 ? undefined : args[tagIndex + 1];
  const isTagValue = Boolean(nextArg) && !nextArg.startsWith('-');
  return isTagValue ? nextArg : null;
};
const explicitTag = readExplicitTag();

const TARGETS = [
  {
    name: 'create-chemx',
    isScoped: false,
    bin: { 'create-chemx': 'cli/create.js', chemx: 'cli/index.js' }
  },
  {
    name: '@chemx/starter-kit',
    isScoped: true,
    bin: {
      'create-chemx': 'cli/create.js',
      chemx: 'cli/index.js',
      'chem-x': 'cli/index.js',
      'chemical-x': 'cli/index.js'
    }
  },
  {
    name: '@chem-x/starter-kit',
    isScoped: true,
    bin: {
      'create-chemx': 'cli/create.js',
      chemx: 'cli/index.js',
      'chem-x': 'cli/index.js',
      'chemical-x': 'cli/index.js'
    }
  },
  {
    name: '@chemx/create-chemx',
    isScoped: true,
    bin: { 'create-chemx': 'cli/create.js', chemx: 'cli/index.js' }
  },
  {
    name: '@chem-x/create-chemx',
    isScoped: true,
    bin: { 'create-chemx': 'cli/create.js', chemx: 'cli/index.js' }
  },
  {
    name: 'chemx',
    isScoped: false,
    bin: { chemx: 'cli/index.js', 'create-chemx': 'cli/create.js' }
  }
];

/** Runs one npm publish and resolves with how it ended. Sets `running` so a signal can stop it. */
function runNpm(args) {
  return new Promise((resolve) => {
    running = spawn('npm', args, {
      cwd: PKG_DIR,
      stdio: 'inherit',
      env: { ...process.env, CHEMX_PREPUBLISH_PASSED: '1' }
    });
    running.on('error', (error) => resolve({ status: null, signal: null, error }));
    running.on('exit', (status, signal) => resolve({ status, signal, error: null }));
  });
}

const originalContent = fs.readFileSync(PKG_JSON, 'utf-8');
const pkg = JSON.parse(originalContent);
const isPrerelease = Boolean(pkg.version && pkg.version.includes('-'));
const tag = explicitTag || (isPrerelease ? 'latest' : null);

const results = [];

// Pre-publish mechanical gate: verify all frameworks compile and typecheck cleanly
await runFrameworkPrePublishGate();
process.env.CHEMX_PREPUBLISH_PASSED = '1';

// npm is async so a signal reaches our handlers while it runs (spawnSync would hold them until it exits).
let running = null;
const restore = restoreOnExit(PKG_JSON, originalContent, {
  stopChild: (signal) => running?.kill(signal),
});

try {
  for (const target of TARGETS) {
    pkg.name = target.name;
    pkg.publishConfig = { access: 'public' };
    if (tag) {
      pkg.publishConfig.tag = tag;
    }
    pkg.bin = target.bin;

    fs.writeFileSync(PKG_JSON, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

    const publishArgs = ['publish', '--access', 'public', '--ignore-scripts'];
    if (isDryRun) publishArgs.push('--dry-run');
    if (otp) publishArgs.push(`--otp=${otp}`);
    if (tag) publishArgs.push('--tag', tag);

    process.stdout.write(`\n\x1b[36m[starter-kit] Publishing: ${target.name} (dry-run: ${isDryRun}${tag ? `, tag: ${tag}` : ''})\x1b[0m\n`);
    const proc = await runNpm(publishArgs);

    results.push({ name: target.name, success: proc.status === 0 });
    const hasProcError = Boolean(proc.error);
    if (hasProcError) process.stderr.write(`\x1b[31m✕ ${target.name}: ${proc.error.message}\x1b[0m\n`);
    // Killed by a signal (Ctrl-C at the OTP prompt): publish nothing further.
    if (proc.signal) break;
  }
} finally {
  restore();
}

process.stdout.write('\n\x1b[1m\x1b[36m--- starter-kit Publish Summary ---\x1b[0m\n');
for (const line of formatPublishSummary(results)) process.stdout.write(line + '\n');
process.stdout.write('\x1b[1m\x1b[36m-----------------------------------\x1b[0m\n\n');

process.exitCode = computePublishExitCode(results, TARGETS.length);
const hasFailedPublish = process.exitCode !== 0;
if (hasFailedPublish) process.stderr.write('\x1b[31m✕ One or more publishes failed.\x1b[0m\n');
