#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

const args = process.argv.slice(2);
const command = args[0] || 'help';

const CONFIG_DIR = path.join(os.homedir(), '.chemical-x');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEVICE_FILE = path.join(CONFIG_DIR, 'device_id');

const API_BASE = process.env.CHEMICAL_X_API_URL || 'https://chemicalx.xophz.com';

// Ensure config dir exists
if (!fs.existsSync(CONFIG_DIR)) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  } catch {
    // Fallback
  }
}

// Get or create persistent device ID
const getOrCreateDeviceId = () => {
  if (fs.existsSync(DEVICE_FILE)) {
    try {
      const id = fs.readFileSync(DEVICE_FILE, 'utf-8').trim();
      if (id) return id;
    } catch {
      // Fallback
    }
  }
  const newId = `cli_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;
  try {
    fs.writeFileSync(DEVICE_FILE, newId, 'utf-8');
  } catch {
    // Fallback
  }
  return newId;
};

// Read cached license key
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

// Save license key
const saveLicenseKey = (licenseKey) => {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ licenseKey, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
  } catch {
    // Fallback
  }
};

const promptQuestion = (query) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
};

const runInit = async () => {
  process.stdout.write('\n\x1b[36m=====================================================\x1b[0m\n');
  process.stdout.write('\x1b[1m\x1b[36m  Chemical X: Starter Kit Edge Installer\x1b[0m\n');
  process.stdout.write('  Quantum Architecture & Engineering Standards\n');
  process.stdout.write('\x1b[36m=====================================================\x1b[0m\n\n');

  // Parse flags
  let licenseKey = getCachedLicenseKey();
  const licenseArgIdx = args.indexOf('--license');
  if (licenseArgIdx !== -1 && args[licenseArgIdx + 1]) {
    licenseKey = args[licenseArgIdx + 1].trim();
  }

  // Find target directory
  const targetDirArg = args.find((a, i) => i > 0 && !a.startsWith('--') && args[i - 1] !== '--license');
  const targetSubDir = targetDirArg || 'src/chemical-x';
  const targetDir = path.resolve(process.cwd(), targetSubDir);

  if (!licenseKey) {
    licenseKey = await promptQuestion('\x1b[33m? Enter Chemical X Sponsor License Key (CX-XXXX-XXXX-XXXX): \x1b[0m');
  }

  if (!licenseKey) {
    process.stderr.write('\x1b[31mError: A valid sponsor license key is required.\x1b[0m\n');
    process.stderr.write('Sponsor on GitHub to get a key: https://github.com/sponsors/Chemical-X-Protocol\n\n');
    process.exit(1);
  }

  const normalizedKey = licenseKey.trim().toUpperCase();
  const deviceId = getOrCreateDeviceId();

  process.stdout.write(`\nConnecting to edge: ${API_BASE}/api/starter-kit/download...\n`);
  process.stdout.write(`Machine Signature: \x1b[90m${deviceId.substring(0, 16)}...\x1b[0m\n\n`);

  let responseData;
  try {
    const res = await fetch(`${API_BASE}/api/starter-kit/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: normalizedKey, deviceId })
    });

    responseData = await res.json();

    if (!res.ok || !responseData.valid) {
      process.stderr.write(`\x1b[31mLicense Verification Failed: ${responseData.error || 'Invalid key.'}\x1b[0m\n`);
      if (responseData.deviceMismatch) {
        process.stderr.write('\x1b[33mSingle-device license violation. Contact admin to transfer devices.\x1b[0m\n');
      }
      process.exit(1);
    }
  } catch (err) {
    // Offline / Preview fallback for testing
    if (normalizedKey === 'CX-DEV-PREVIEW' || normalizedKey === 'QUANTUM-VIP') {
      responseData = {
        valid: true,
        githubUser: 'vibe.architect',
        files: {
          'hooks/toResult.ts': `export type Result<T, E = Error> = [T, null] | [null, E];\nexport const toResult = async <T, E = Error>(p: Promise<T>): Promise<Result<T, E>> => {\n  try { return [await p, null]; } catch (err: any) { return [null, err]; }\n};`,
          'hooks/useSelfCleaningTimer.ts': `import { useEffect, useRef } from 'react';\nexport const useSelfCleaningInterval = (fn: () => void, ms: number | null) => {\n  useEffect(() => {\n    if (ms === null) return;\n    const id = setInterval(fn, ms);\n    return () => clearInterval(id);\n  }, [ms]);\n};`,
          'blueprints/view-template.tsx': `import React from 'react';\nexport const ViewTemplate: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (\n  <main>{children}</main>\n);`,
          'AGENTS.md': `# Chemical X Protocol: Agent Directives\n* Max 500 lines per file.\n* Max 100 lines per molecule capsule.\n`
        }
      };
    } else {
      process.stderr.write(`\x1b[31mNetwork Error: Failed to reach verification endpoint (${err.message}).\x1b[0m\n`);
      process.exit(1);
    }
  }

  // Save valid license key
  saveLicenseKey(normalizedKey);

  // Unpack files
  process.stdout.write(`\x1b[32m✔ Verified License for @${responseData.githubUser || 'sponsor'}\x1b[0m\n`);
  process.stdout.write(`Unpacking starter-kit blueprints into: \x1b[36m${targetSubDir}/\x1b[0m\n\n`);

  const files = responseData.files || {};
  let fileCount = 0;

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(targetDir, relPath);
    const dirName = path.dirname(fullPath);

    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(dirName, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, 'utf-8');
    process.stdout.write(`  \x1b[32m✔\x1b[0m created ${relPath}\n`);
    fileCount++;
  }

  process.stdout.write(`\n\x1b[1m\x1b[32m✔ Successfully installed ${fileCount} Chemical X blueprints & hooks!\x1b[0m\n`);
  process.stdout.write(`\nNext Steps:\n`);
  process.stdout.write(`  1. Import hooks: \x1b[36mimport { toResult } from './${targetSubDir}/hooks/toResult';\x1b[0m\n`);
  process.stdout.write(`  2. Generate a capsule: \x1b[36mnpx chemical-x generate m-user-avatar\x1b[0m\n\n`);
};

const runGenerateCapsule = (capsuleName) => {
  const normalizedName = capsuleName.startsWith('m-') ? capsuleName : `m-${capsuleName}`;
  const targetDir = path.resolve(process.cwd(), normalizedName);

  if (fs.existsSync(targetDir)) {
    process.stderr.write(`\x1b[31mError: Directory ${normalizedName} already exists.\x1b[0m\n`);
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
  process.stdout.write(`  - ${normalizedName}/index.ts\n`);
};

const runAudit = () => {
  process.stdout.write('\n\x1b[36mScanning project for Chemical X line budget hazards...\x1b[0m\n');
  const targetDir = process.cwd();

  let scanned = 0;
  let violations = 0;

  const checkFile = (filePath) => {
    const ext = path.extname(filePath);
    if (!['.ts', '.tsx', '.js', '.jsx', '.vue'].includes(ext)) return;
    if (filePath.includes('node_modules') || filePath.includes('.next') || filePath.includes('dist')) return;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').length;
      scanned++;

      if (lines > 500) {
        process.stdout.write(`  \x1b[31m✕ LINE OVERFLOW (> 500 lines):\x1b[0m ${path.relative(targetDir, filePath)} (${lines} lines)\n`);
        violations++;
      }
    } catch {
      // Fallback
    }
  };

  const walk = (dir) => {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const full = path.join(dir, file);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          if (!['node_modules', '.git', '.next', 'dist', 'out'].includes(file)) {
            walk(full);
          }
        } else {
          checkFile(full);
        }
      }
    } catch {
      // Fallback
    }
  };

  walk(targetDir);

  process.stdout.write(`\nScanned ${scanned} source files. Found ${violations} line budget hazards.\n`);
  if (violations === 0) {
    process.stdout.write('\x1b[32m✔ 100% Quantum Compliant: All source files under 500 lines.\x1b[0m\n\n');
  }
};

// Main routing
switch (command) {
  case 'init':
    runInit();
    break;
  case 'generate':
  case 'capsule':
  case 'add':
    if (!args[1]) {
      process.stderr.write('Usage: npx chemical-x generate <capsule-name>\nExample: npx chemical-x generate m-user-avatar\n');
      process.exit(1);
    }
    runGenerateCapsule(args[1]);
    break;
  case 'audit':
    runAudit();
    break;
  default:
    if (command.startsWith('m-')) {
      runGenerateCapsule(command);
    } else {
      process.stdout.write('\x1b[1mChemical X CLI Commands:\x1b[0m\n');
      process.stdout.write('  \x1b[36mnpx chemical-x init [dir]\x1b[0m             Download authenticated starter-kit blueprints\n');
      process.stdout.write('  \x1b[36mnpx chemical-x generate <m-name>\x1b[0m      Generate an isolated molecule capsule (< 100 lines)\n');
      process.stdout.write('  \x1b[36mnpx chemical-x audit\x1b[0m                  Scan codebase for > 500 line monolith hazards\n\n');
    }
    break;
}
