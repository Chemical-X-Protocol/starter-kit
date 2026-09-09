#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { runAudit as executeAstAudit, auditFile } from './audit.js';

const rawArgs = process.argv.slice(2);
const invokedBin = path.basename(process.argv[1] || '');
const isCreateInvoked = invokedBin.includes('create-chemx') || (rawArgs[0] && rawArgs[0] === 'create');

const CONFIG_DIR = path.join(os.homedir(), '.chemical-x');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEVICE_FILE = path.join(CONFIG_DIR, 'device_id');

const API_BASE = process.env.CHEMICAL_X_API_URL || 'https://chemicalx.xophz.com';
const URL_STANDARD = 'https://mycompassconsulting.com/buy/chemical-x/standard';
const URL_MASTER = 'https://mycompassconsulting.com/buy/chemical-x/master';

if (!fs.existsSync(CONFIG_DIR)) {
  try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}
}

const openBrowser = (url) => {
  const platform = process.platform;
  try {
    if (platform === 'darwin') spawnSync('open', [url], { stdio: 'ignore' });
    else if (platform === 'win32') spawnSync('cmd.exe', ['/c', 'start', '""', url], { stdio: 'ignore' });
    else spawnSync('xdg-open', [url], { stdio: 'ignore' });
  } catch {}
};

const hasGum = () => {
  try {
    return spawnSync('which', ['gum'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
};

const gumChoose = (options, header = '') => {
  const args = ['choose', ...options, '--cursor.foreground=81'];
  if (header) {
    args.unshift(`--header=${header}`, '--header.foreground=81');
  }
  const res = spawnSync('gum', args, { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'inherit'] });
  return (res.stdout || '').trim();
};

const gumInput = (promptText, placeholder = '', isPassword = false) => {
  const args = ['input', `--prompt=${promptText} `, `--placeholder=${placeholder}`];
  if (isPassword) args.push('--password');
  const res = spawnSync('gum', args, { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'inherit'] });
  return (res.stdout || '').trim();
};

const promptQuestion = (query) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
};

const getOrCreateDeviceId = () => {
  if (fs.existsSync(DEVICE_FILE)) {
    try {
      const id = fs.readFileSync(DEVICE_FILE, 'utf-8').trim();
      if (id) return id;
    } catch {}
  }
  const newId = `cli_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;
  try { fs.writeFileSync(DEVICE_FILE, newId, 'utf-8'); } catch {}
  return newId;
};

const getCachedLicenseKey = () => {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      return data.licenseKey || null;
    } catch {
      return null;
    }
  }
  return null;
};

const saveLicenseKey = (licenseKey) => {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ licenseKey, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
  } catch {}
};

const renderBanner = (title = 'Chemical X Protocol: Quantum Architecture') => {
  if (hasGum()) {
    spawnSync('gum', [
      'style',
      '--border=normal',
      '--margin=1',
      '--padding=1 2',
      '--border-foreground=45',
      '--foreground=81',
      '--bold',
      `  ${title}\n  Zero-Context-Rot Scaffolding & Engineering Directives`
    ], { stdio: 'inherit' });
  } else {
    process.stdout.write('\n\x1b[38;2;98;201;255m=====================================================\x1b[0m\n');
    process.stdout.write(`\x1b[1m\x1b[38;2;98;201;255m  ${title}\x1b[0m\n`);
    process.stdout.write('  Zero-Context-Rot Scaffolding & Engineering Directives\n');
    process.stdout.write('\x1b[38;2;98;201;255m=====================================================\x1b[0m\n\n');
  }
};

const obtainLicenseKey = async () => {
  let cached = getCachedLicenseKey();
  const cliFlagIdx = rawArgs.indexOf('--license');
  if (cliFlagIdx !== -1 && rawArgs[cliFlagIdx + 1]) {
    cached = rawArgs[cliFlagIdx + 1].trim();
  }

  if (cached) {
    return cached;
  }

  const useGum = hasGum();

  if (useGum) {
    const choice = gumChoose([
      '1. Buy Standard Edition ($49) -> Launch Checkout',
      '2. Buy Master Bundle ($99) -> Launch Checkout',
      '3. Enter License Key (CX-XXXX-XXXX-XXXX)',
      '4. Run Free Public Audit (npx chemx audit)',
      '5. Exit'
    ], 'Chemical X Scaffolding Requires a Paid License:');

    if (choice.startsWith('1.')) {
      process.stdout.write(`\x1b[36mOpening checkout in default browser:\x1b[0m ${URL_STANDARD}\n`);
      openBrowser(URL_STANDARD);
      process.stdout.write('\nOnce completed, paste your Sponsor / VIP License Key below.\n');
      return gumInput('License Key (CX-XXXX-XXXX-XXXX):', 'CX-XXXX-XXXX-XXXX');
    }

    if (choice.startsWith('2.')) {
      process.stdout.write(`\x1b[36mOpening checkout in default browser:\x1b[0m ${URL_MASTER}\n`);
      openBrowser(URL_MASTER);
      process.stdout.write('\nOnce completed, paste your Sponsor / VIP License Key below.\n');
      return gumInput('License Key (CX-XXXX-XXXX-XXXX):', 'CX-XXXX-XXXX-XXXX');
    }

    if (choice.startsWith('3.')) {
      return gumInput('License Key (CX-XXXX-XXXX-XXXX):', 'CX-XXXX-XXXX-XXXX');
    }

    if (choice.startsWith('4.')) {
      await runAudit(null, true);
    }

    if (choice.startsWith('5.') || !choice) {
      process.exit(0);
    }

    return gumInput('License Key (CX-XXXX-XXXX-XXXX):', 'CX-XXXX-XXXX-XXXX');
  }

  process.stdout.write('\x1b[1mChemical X Scaffolding Requires a Paid License:\x1b[0m\n');
  process.stdout.write('  [1] Buy Standard Edition ($49) - Opens browser\n');
  process.stdout.write('  [2] Buy Master Bundle ($99) - Opens browser\n');
  process.stdout.write('  [3] Enter License Key\n');
  process.stdout.write('  [4] Run Free Public Audit (npx chemx audit)\n');
  process.stdout.write('  [5] Exit\n\n');

  const selection = await promptQuestion('Select option [1-5]: ');

  if (selection === '1') {
    process.stdout.write(`Opening: ${URL_STANDARD}\n`);
    openBrowser(URL_STANDARD);
    return promptQuestion('Enter License Key after purchase: ');
  }

  if (selection === '2') {
    process.stdout.write(`Opening: ${URL_MASTER}\n`);
    openBrowser(URL_MASTER);
    return promptQuestion('Enter License Key after purchase: ');
  }

  if (selection === '3') {
    return promptQuestion('Enter License Key (CX-XXXX-XXXX-XXXX): ');
  }

  if (selection === '4') {
    await runAudit(null, true);
  }

  if (selection === '5') {
    process.exit(0);
  }

  return promptQuestion('Enter Chemical X Sponsor License Key (CX-XXXX-XXXX-XXXX): ');
};

const fetchStarterKitFiles = async (licenseKey) => {
  const normalizedKey = licenseKey.trim().toUpperCase();
  const deviceId = getOrCreateDeviceId();

  process.stdout.write(`\nVerifying license via edge: ${API_BASE}...\n`);

  try {
    const res = await fetch(`${API_BASE}/api/starter-kit/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: normalizedKey, deviceId })
    });

    const responseData = await res.json();

    if (!res.ok || !responseData.valid) {
      process.stderr.write(`\x1b[31m✕ License Verification Failed: ${responseData.error || 'Invalid key.'}\x1b[0m\n`);
      process.stderr.write(`Purchase key at: ${URL_STANDARD}\n\n`);
      process.exit(1);
    }

    saveLicenseKey(normalizedKey);
    process.stdout.write(`\x1b[32m✔ Verified License for @${responseData.githubUser || 'sponsor'}\x1b[0m\n\n`);
    return responseData.files || {};
  } catch (err) {
    process.stderr.write(`\x1b[31m✕ Network Error: Failed to reach edge server (${err.message}).\x1b[0m\n`);
    process.exit(1);
  }
};

const runScaffold = async (projectName) => {
  renderBanner('Chemical X: Quantum Scaffolder (npm create chemx)');

  const licenseKey = await obtainLicenseKey();
  if (!licenseKey) {
    process.stderr.write('\x1b[31m✕ Valid license key is required to scaffold blueprints.\x1b[0m\n');
    process.exit(1);
  }

  let targetName = projectName;
  if (!targetName) {
    if (hasGum()) {
      targetName = gumInput('Project directory name:', 'my-quantum-app');
    } else {
      targetName = await promptQuestion('Project directory name [my-quantum-app]: ');
    }
  }

  const finalDirName = targetName.trim() || 'my-quantum-app';
  const targetDir = path.resolve(process.cwd(), finalDirName);

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    process.stderr.write(`\x1b[31m✕ Error: Directory '${finalDirName}' already exists and is not empty.\x1b[0m\n`);
    process.exit(1);
  }

  const files = await fetchStarterKitFiles(licenseKey);

  process.stdout.write(`Scaffolding Quantum Architecture into: \x1b[36m${finalDirName}/\x1b[0m\n`);
  fs.mkdirSync(targetDir, { recursive: true });

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(targetDir, relPath);
    const dirName = path.dirname(fullPath);
    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(dirName, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf-8');
    process.stdout.write(`  \x1b[32m✔\x1b[0m ${relPath}\n`);
  }

  const cursorRulesPath = path.join(targetDir, '.cursorrules');
  if (!fs.existsSync(cursorRulesPath)) {
    const rules = `# Chemical X Quantum Architecture Directives\nStrictly follow AGENTS.md rules. Never exceed 500 lines per file. All molecule capsules must stay under 100 lines.\n`;
    fs.writeFileSync(cursorRulesPath, rules, 'utf-8');
    process.stdout.write(`  \x1b[32m✔\x1b[0m .cursorrules\n`);
  }

  process.stdout.write(`\n\x1b[1m\x1b[32m✔ Quantum project created successfully at ${finalDirName}!\x1b[0m\n\n`);
  process.stdout.write('Next Steps:\n');
  process.stdout.write(`  1. cd ${finalDirName}\n`);
  process.stdout.write('  2. Review AGENTS.md for line budgets and architecture standards\n');
  process.stdout.write('  3. Run npx chemx generate m-<feature> to create capsules\n');
  process.stdout.write('  4. Run npx chemx audit to scan for line budget compliance\n\n');
};

const runInit = async (targetSubDir = 'src/chemical-x') => {
  renderBanner('Chemical X: In-Repo Capsule Drop-in');

  const targetDir = path.resolve(process.cwd(), targetSubDir);
  const licenseKey = await obtainLicenseKey();
  if (!licenseKey) {
    process.stderr.write('\x1b[31m✕ Valid license key is required.\x1b[0m\n');
    process.exit(1);
  }

  const files = await fetchStarterKitFiles(licenseKey);

  process.stdout.write(`Unpacking blueprints and hooks into: \x1b[36m${targetSubDir}/\x1b[0m\n`);

  let count = 0;
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(targetDir, relPath);
    const dirName = path.dirname(fullPath);
    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(dirName, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf-8');
    process.stdout.write(`  \x1b[32m✔\x1b[0m ${relPath}\n`);
    count++;
  }

  process.stdout.write(`\n\x1b[1m\x1b[32m✔ Successfully installed ${count} Chemical X assets into ${targetSubDir}!\x1b[0m\n\n`);
};

const runGenerateCapsule = (capsuleName) => {
  const normalizedName = capsuleName.startsWith('m-') ? capsuleName : `m-${capsuleName}`;
  const targetDir = path.resolve(process.cwd(), normalizedName);

  if (fs.existsSync(targetDir)) {
    process.stderr.write(`\x1b[31m✕ Error: Directory ${normalizedName} already exists.\x1b[0m\n`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const pascalName = normalizedName
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');

  const componentCode = `import React from 'react';
import type { ${pascalName}Props } from './types';

export const ${pascalName}: React.FC<${pascalName}Props> = ({ label }) => {
  return (
    <div className="${normalizedName}">
      <span>{label}</span>
    </div>
  );
};

export default ${pascalName};
`;

  const typesCode = `export interface ${pascalName}Props {
  readonly label: string;
}
`;

  const indexCode = `export { ${pascalName} } from './${normalizedName}';
export type { ${pascalName}Props } from './types';
`;

  fs.writeFileSync(path.join(targetDir, `${normalizedName}.tsx`), componentCode, 'utf-8');
  fs.writeFileSync(path.join(targetDir, 'types.d.ts'), typesCode, 'utf-8');
  fs.writeFileSync(path.join(targetDir, 'index.ts'), indexCode, 'utf-8');

  process.stdout.write(`\x1b[32m✔ Successfully generated crystalline capsule:\x1b[0m ${normalizedName}/\n`);
  process.stdout.write(`  - ${normalizedName}/${normalizedName}.tsx (< 50 lines)\n`);
  process.stdout.write(`  - ${normalizedName}/types.d.ts\n`);
  process.stdout.write(`  - ${normalizedName}/index.ts\n\n`);
};

export const runAudit = async (customDir = null, isCli = false) => {
  const isJson = rawArgs.includes('--json');
  const dirFlag = rawArgs.find((arg) => arg.startsWith('--dir='));
  const targetDir = customDir || (dirFlag ? dirFlag.split('=')[1] : (fs.existsSync('src') ? 'src' : '.'));

  const report = executeAstAudit(targetDir);

  if (isJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (isCli) process.exit(report.violations.length > 0 ? 1 : 0);
    return report;
  }

  process.stdout.write('\n\x1b[38;2;98;201;255m[Chemical X Context Hazard Audit]\x1b[0m Scanning codebase for AST architectural hazards...\n');
  process.stdout.write(`Target Directory: ${targetDir}\n`);
  process.stdout.write(`Scanned ${report.scannedFiles} source files.\n\n`);

  if (report.violations.length === 0) {
    process.stdout.write('\x1b[1m\x1b[32m✔ 100% Quantum Compliant: Zero context hazard violations detected across all line budgets, hooks, and AST rules.\x1b[0m\n\n');
  } else {
    process.stdout.write(`\x1b[31m✕ FAILED: ${report.totalViolations} context hazard violations detected:\x1b[0m\n\n`);
    for (const v of report.violations) {
      process.stdout.write(`  \x1b[31m[${v.rule}]\x1b[0m \x1b[33m${v.filePath}:${v.line}\x1b[0m\n`);
      process.stdout.write(`    Hazard:    ${v.hazard}\n`);
      process.stdout.write(`    Directive: ${v.directive}\n\n`);
    }
  }

  if (isCli) {
    while (true) {
      if (hasGum()) {
        spawnSync('gum', [
          'style',
          '--border=rounded',
          '--border-foreground=81',
          '--padding=0 1',
          '--bold',
          'Eliminate AI Context Rot with Chemical X Architecture'
        ], { stdio: 'inherit' });

        const choice = gumChoose([
          '1. Buy Standard Edition ($49) -> Launch Checkout',
          '2. Buy Master Bundle ($99) -> Launch Checkout',
          '3. Enter License Key to Scaffold (Paid License Holders)',
          '4. Exit'
        ], 'Select a CTA action:');

        if (choice.startsWith('1.')) {
          process.stdout.write(`\n\x1b[36mOpening Standard Edition checkout in browser:\x1b[0m ${URL_STANDARD}\n\n`);
          openBrowser(URL_STANDARD);
          continue;
        }
        if (choice.startsWith('2.')) {
          process.stdout.write(`\n\x1b[36mOpening Master Bundle checkout in browser:\x1b[0m ${URL_MASTER}\n\n`);
          openBrowser(URL_MASTER);
          continue;
        }
        if (choice.startsWith('3.')) {
          await runScaffold();
          break;
        }
        break;
      } else {
        process.stdout.write('\x1b[1m\x1b[38;2;98;201;255mEliminate AI Context Rot with Chemical X Architecture:\x1b[0m\n');
        process.stdout.write(`  [1] Buy Standard Edition ($49) - ${URL_STANDARD}\n`);
        process.stdout.write(`  [2] Buy Master Bundle ($99) - ${URL_MASTER}\n`);
        process.stdout.write('  [3] Enter License Key to Scaffold (Paid License Holders)\n');
        process.stdout.write('  [4] Exit\n\n');

        const selection = await promptQuestion('Select option [1-4]: ');
        if (selection === '1') {
          process.stdout.write(`\nOpening: ${URL_STANDARD}\n\n`);
          openBrowser(URL_STANDARD);
          continue;
        }
        if (selection === '2') {
          process.stdout.write(`\nOpening: ${URL_MASTER}\n\n`);
          openBrowser(URL_MASTER);
          continue;
        }
        if (selection === '3') {
          await runScaffold();
          break;
        }
        break;
      }
    }
    process.exit(report.violations.length > 0 ? 1 : 0);
  }
  return report;
};

export { auditFile };

const printHelp = () => {
  renderBanner();
  process.stdout.write('\x1b[1mAvailable Commands:\x1b[0m\n');
  process.stdout.write('  \x1b[36mnpm create chemx [dir]\x1b[0m              [PAID] Scaffold complete Quantum Architecture project\n');
  process.stdout.write('  \x1b[36mnpx @chemx/starter-kit init [dir]\x1b[0m   [PAID] Drop blueprints & hooks into existing project\n');
  process.stdout.write('  \x1b[36mnpx chemx generate <m-name>\x1b[0m         Generate isolated molecule capsule (< 100 lines)\n');
  process.stdout.write('  \x1b[36mnpx chemx audit [--json] [--dir=src]\x1b[0m[FREE] Scan codebase for AST architectural hazards\n\n');
};

const main = async () => {
  const firstArg = rawArgs[0];

  if (isCreateInvoked) {
    const dirArg = firstArg === 'create' ? rawArgs[1] : firstArg;
    await runScaffold(dirArg);
    return;
  }

  switch (firstArg) {
    case 'audit':
      await runAudit(null, true);
      break;
    case 'init':
      await runInit(rawArgs[1] || 'src/chemical-x');
      break;
    case 'create':
      await runScaffold(rawArgs[1]);
      break;
    case 'generate':
    case 'capsule':
    case 'add':
      if (!rawArgs[1]) {
        process.stderr.write('Usage: npx chemx generate <capsule-name>\nExample: npx chemx generate m-user-avatar\n');
        process.exit(1);
      }
      runGenerateCapsule(rawArgs[1]);
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      if (firstArg && firstArg.startsWith('m-')) {
        runGenerateCapsule(firstArg);
      } else if (firstArg && !firstArg.startsWith('-')) {
        await runScaffold(firstArg);
      } else {
        printHelp();
      }
      break;
  }
};

main().catch((err) => {
  process.stderr.write(`\x1b[31m✕ Unexpected Error: ${err.message}\x1b[0m\n`);
  process.exit(1);
});

