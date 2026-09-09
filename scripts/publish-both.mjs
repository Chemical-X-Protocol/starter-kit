#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_DIR = path.resolve(__dirname, '..');
const PKG_JSON = path.join(PKG_DIR, 'package.json');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const otpArg = args.find((a) => a.startsWith('--otp='));
const otp = otpArg ? otpArg.split('=')[1] : null;
const tagArg = args.find((a) => a.startsWith('--tag='));
const tagIndex = args.indexOf('--tag');
const explicitTag = tagArg
  ? tagArg.split('=')[1]
  : tagIndex !== -1 && args[tagIndex + 1] && !args[tagIndex + 1].startsWith('-')
    ? args[tagIndex + 1]
    : null;

const TARGETS = [
  {
    name: 'create-chemx',
    isScoped: false,
    bin: { 'create-chemx': 'cli/index.js', chemx: 'cli/index.js' }
  },
  {
    name: '@chemx/starter-kit',
    isScoped: true,
    bin: {
      'create-chemx': 'cli/index.js',
      chemx: 'cli/index.js',
      'chem-x': 'cli/index.js',
      'chemical-x': 'cli/index.js'
    }
  },
  {
    name: '@chem-x/starter-kit',
    isScoped: true,
    bin: {
      'create-chemx': 'cli/index.js',
      chemx: 'cli/index.js',
      'chem-x': 'cli/index.js',
      'chemical-x': 'cli/index.js'
    }
  },
  {
    name: '@chemx/create-chemx',
    isScoped: true,
    bin: { 'create-chemx': 'cli/index.js', chemx: 'cli/index.js' }
  },
  {
    name: '@chem-x/create-chemx',
    isScoped: true,
    bin: { 'create-chemx': 'cli/index.js', chemx: 'cli/index.js' }
  },
  {
    name: 'chemx',
    isScoped: false,
    bin: { chemx: 'cli/index.js', 'create-chemx': 'cli/index.js' }
  },
  {
    name: 'chem-x',
    isScoped: false,
    bin: { 'chem-x': 'cli/index.js', 'create-chemx': 'cli/index.js' }
  }
];

const originalContent = fs.readFileSync(PKG_JSON, 'utf-8');
const pkg = JSON.parse(originalContent);
const isPrerelease = Boolean(pkg.version && pkg.version.includes('-'));
const tag = explicitTag || (isPrerelease ? 'latest' : null);

const results = [];

try {
  for (const target of TARGETS) {
    pkg.name = target.name;
    pkg.publishConfig = { access: 'public' };
    if (tag) {
      pkg.publishConfig.tag = tag;
    }
    pkg.bin = target.bin;

    fs.writeFileSync(PKG_JSON, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

    const publishArgs = ['publish', '--access', 'public'];
    if (isDryRun) publishArgs.push('--dry-run');
    if (otp) publishArgs.push(`--otp=${otp}`);
    if (tag) publishArgs.push('--tag', tag);

    console.log(`\n\x1b[36m[starter-kit] Publishing: ${target.name} (dry-run: ${isDryRun}${tag ? `, tag: ${tag}` : ''})\x1b[0m`);
    const proc = spawnSync('npm', publishArgs, {
      cwd: PKG_DIR,
      stdio: 'inherit'
    });

    results.push({ name: target.name, success: proc.status === 0 });
  }
} finally {
  fs.writeFileSync(PKG_JSON, originalContent, 'utf-8');
}

console.log('\n\x1b[1m\x1b[36m--- starter-kit Publish Summary ---\x1b[0m');
for (const res of results) {
  const icon = res.success ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✕\x1b[0m';
  console.log(`  ${icon} ${res.name.padEnd(25)} ${res.success ? 'Published' : 'Failed'}`);
}
console.log('\x1b[1m\x1b[36m-----------------------------------\x1b[0m\n');
