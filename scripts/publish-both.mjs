#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runFrameworkPrePublishGate } from './check-framework-generation.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_DIR = path.resolve(__dirname, '..');

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

const parsePublishArgs = (args) => {
  const otpArg = args.find((a) => a.startsWith('--otp='));
  const tagArg = args.find((a) => a.startsWith('--tag='));
  const tagValue = args[args.indexOf('--tag') + 1];
  const hasTagFlag = args.includes('--tag');
  const isTagValue = Boolean(tagValue) && !tagValue.startsWith('-');
  const flagTag = hasTagFlag && isTagValue ? tagValue : null;
  return {
    isDryRun: args.includes('--dry-run'),
    otp: otpArg ? otpArg.split('=')[1] : null,
    explicitTag: tagArg ? tagArg.split('=')[1] : flagTag
  };
};

// A null status means npm never ran or died on a signal, so it is never a success.
const toPublishResult = (name, proc) => ({
  name,
  success: proc.status === 0,
  status: proc.status ?? null,
  signal: proc.signal ?? null,
  error: proc.error?.message ?? null
});

export const resolvePublishExitCode = (results, expectedCount) => {
  const hasFailure = results.some((res) => !res.success);
  const isIncomplete = results.length !== expectedCount;
  return hasFailure || isIncomplete ? 1 : 0;
};

const describeFailure = (res) => res.error ?? (res.signal ? `signal ${res.signal}` : `exit ${res.status}`);

const printSummary = (results, targets) => {
  console.log('\n\x1b[1m\x1b[36m--- starter-kit Publish Summary ---\x1b[0m');
  for (const res of results) {
    const icon = res.success ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✕\x1b[0m';
    const outcome = res.success ? 'Published' : `Failed (${describeFailure(res)})`;
    console.log(`  ${icon} ${res.name.padEnd(25)} ${outcome}`);
  }
  console.log('\x1b[1m\x1b[36m-----------------------------------\x1b[0m\n');

  const failed = results.filter((res) => !res.success);
  if (failed.length > 0) {
    const names = failed.map((res) => res.name).join(', ');
    console.error(`\x1b[31m✕ ${failed.length} of ${targets.length} target(s) failed: ${names}\x1b[0m`);
  }
};

export const runPublishBoth = async ({
  pkgDir = PKG_DIR,
  targets = TARGETS,
  args = process.argv.slice(2),
  spawn = spawnSync,
  runGate = runFrameworkPrePublishGate
} = {}) => {
  const { isDryRun, otp, explicitTag } = parsePublishArgs(args);
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  const originalContent = fs.readFileSync(pkgJsonPath, 'utf-8');
  const pkg = JSON.parse(originalContent);
  const isPrerelease = Boolean(pkg.version && pkg.version.includes('-'));
  const tag = explicitTag || (isPrerelease ? 'latest' : null);

  const results = [];

  // Pre-publish mechanical gate: verify all frameworks compile and typecheck cleanly
  await runGate();

  try {
    for (const target of targets) {
      pkg.name = target.name;
      pkg.publishConfig = { access: 'public' };
      if (tag) {
        pkg.publishConfig.tag = tag;
      }
      pkg.bin = target.bin;

      fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

      const publishArgs = ['publish', '--access', 'public'];
      if (isDryRun) publishArgs.push('--dry-run');
      if (otp) publishArgs.push(`--otp=${otp}`);
      if (tag) publishArgs.push('--tag', tag);

      console.log(`\n\x1b[36m[starter-kit] Publishing: ${target.name} (dry-run: ${isDryRun}${tag ? `, tag: ${tag}` : ''})\x1b[0m`);
      const proc = spawn('npm', publishArgs, {
        cwd: pkgDir,
        stdio: 'inherit'
      });

      results.push(toPublishResult(target.name, proc));
    }
  } finally {
    fs.writeFileSync(pkgJsonPath, originalContent, 'utf-8');
  }

  printSummary(results, targets);
  return resolvePublishExitCode(results, targets.length);
};

// Node resolves symlinks in import.meta.url but leaves argv[1] as typed, so both sides are realpath'd.
export const isDirectRun = (argv1, moduleUrl) => {
  const hasInvokedFile = Boolean(argv1) && fs.existsSync(argv1);
  if (!hasInvokedFile) return false;
  return fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(moduleUrl));
};

// Set exitCode rather than calling exit() so npm output on inherited stdio is flushed first.
if (isDirectRun(process.argv[1], import.meta.url)) {
  process.exitCode = await runPublishBoth();
}
