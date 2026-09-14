import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  hasGum,
  gumChoose,
  gumInput,
  promptQuestion,
  openBrowser
} from './terminal.js';
import { toResultSync } from './audit/rules-helpers.js';

export const CONFIG_DIR = path.join(os.homedir(), '.chemical-x');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
export const DEVICE_FILE = path.join(CONFIG_DIR, 'device_id');

export const API_BASE = process.env.CHEMICAL_X_API_URL || 'https://chemicalx.xophz.com';
export const GATEKEEPER_API_URL = process.env.COMPASS_GATEKEEPER_URL || 'https://mycompassconsulting.com/wp-json/compass/v1/gatekeeper';
export const URL_LEARN = 'https://chemicalx.xophz.com';
export const URL_SPONSOR = 'https://github.com/sponsors/Chemical-X-Protocol';
export const URL_STANDARD = 'https://mycompassconsulting.com/buy/chemical-x/standard';
export const URL_MASTER = 'https://mycompassconsulting.com/buy/chemical-x/master';

export const verifyWithGatekeeper = async (keyOrUser, deviceId = null) => {
  const effectiveDeviceId = deviceId || getOrCreateDeviceId();
  try {
    const res = await fetch(`${GATEKEEPER_API_URL}/licenses/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: keyOrUser, deviceId: effectiveDeviceId })
    });
    if (!res.ok) return { valid: false };
    return await res.json();
  } catch {
    return { valid: false };
  }
};


export const ensureConfigDir = () => {
  if (fs.existsSync(CONFIG_DIR)) return true;
  const [, err] = toResultSync(() => fs.mkdirSync(CONFIG_DIR, { recursive: true }));
  if (err) {
    return false;
  }
  return true;
};

export const getOrCreateDeviceId = () => {
  if (fs.existsSync(DEVICE_FILE)) {
    try {
      const id = fs.readFileSync(DEVICE_FILE, 'utf-8').trim();
      if (id) return id;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      process.stderr.write(`Failed to read device id: ${error.message}\n`);
    }
  }
  const newId = `cli_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;
  ensureConfigDir();
  try {
    fs.writeFileSync(DEVICE_FILE, newId, 'utf-8');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    process.stderr.write(`Failed to write device id: ${error.message}\n`);
  }
  return newId;
};

export const getCachedLicenseKey = () => {
  if (!fs.existsSync(CONFIG_FILE)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    return data.licenseKey || null;
  } catch {
    return null;
  }
};

export const saveLicenseKey = (licenseKey) => {
  ensureConfigDir();
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify({ licenseKey, updatedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    process.stderr.write(`Failed to cache license key: ${error.message}\n`);
  }
};

const resolveFlagLicense = (args) => {
  const cliFlagIdx = args.indexOf('--license');
  const hasFlag = cliFlagIdx !== -1 && Boolean(args[cliFlagIdx + 1]);
  if (!hasFlag) return null;
  return args[cliFlagIdx + 1].trim();
};

export const obtainLicenseKey = async (rawArgs = [], onRunAudit = null) => {
  const flagKey = resolveFlagLicense(rawArgs);
  const effectiveKey = flagKey || getCachedLicenseKey();

  if (effectiveKey) {
    return effectiveKey;
  }

  const useGum = hasGum();

  if (useGum) {
    const choice = gumChoose(
      [
        '1. Visit chemicalx.xophz.com to learn more',
        '2. Buy Standard Vault: Single Dev License ($27) -> Launch Checkout',
        '3. Buy Team Power Puff: Unlimited Lifetime ($97) -> Launch Checkout',
        '4. Enter License Key (CX-XXXX-XXXX-XXXX)',
        '5. Run Free Public Audit (npx chemx audit)',
        '6. Exit'
      ],
      'Chemical X Scaffolding Requires a Paid License:'
    );

    if (choice.startsWith('1.')) {
      process.stdout.write(`\x1b[36mOpening Chemical X Portal in default browser:\x1b[0m ${URL_LEARN}\n`);
      openBrowser(URL_LEARN);
      process.stdout.write('\nOnce completed, paste your Sponsor / VIP License Key below.\n');
      return gumInput('License Key (CX-XXXX-XXXX-XXXX):', 'CX-XXXX-XXXX-XXXX');
    }

    if (choice.startsWith('2.')) {
      process.stdout.write(`\x1b[36mOpening Standard Vault checkout (Single Dev License) in default browser:\x1b[0m ${URL_STANDARD}\n`);
      openBrowser(URL_STANDARD);
      process.stdout.write('\nOnce completed, paste your Sponsor / VIP License Key below.\n');
      return gumInput('License Key (CX-XXXX-XXXX-XXXX):', 'CX-XXXX-XXXX-XXXX');
    }

    if (choice.startsWith('3.')) {
      process.stdout.write(`\x1b[36mOpening Team Power Puff checkout (Unlimited Lifetime) in default browser:\x1b[0m ${URL_MASTER}\n`);
      openBrowser(URL_MASTER);
      process.stdout.write('\nOnce completed, paste your Sponsor / VIP License Key below.\n');
      return gumInput('License Key (CX-XXXX-XXXX-XXXX):', 'CX-XXXX-XXXX-XXXX');
    }

    if (choice.startsWith('4.')) {
      return gumInput('License Key (CX-XXXX-XXXX-XXXX):', 'CX-XXXX-XXXX-XXXX');
    }

    if (choice.startsWith('5.') && onRunAudit) {
      await onRunAudit(null, true);
    }

    const isExitChoice = choice.startsWith('6.') || !choice;
    if (isExitChoice) {
      process.exit(0);
    }

    return gumInput('License Key (CX-XXXX-XXXX-XXXX):', 'CX-XXXX-XXXX-XXXX');
  }

  process.stdout.write('\x1b[1mChemical X Scaffolding Requires a Paid License:\x1b[0m\n');
  process.stdout.write('  [1] Visit chemicalx.xophz.com to learn more\n');
  process.stdout.write('  [2] Buy Standard Vault: Single Dev License ($27) - Opens browser\n');
  process.stdout.write('  [3] Buy Team Power Puff: Unlimited Lifetime ($97) - Opens browser\n');
  process.stdout.write('  [4] Enter License Key\n');
  process.stdout.write('  [5] Run Free Public Audit (npx chemx audit)\n');
  process.stdout.write('  [6] Exit\n\n');

  const selection = await promptQuestion('Select option [1-6] (default: 1): ');
  const effectiveChoice = selection.trim() || '1';

  if (effectiveChoice === '1') {
    process.stdout.write(`Opening: ${URL_LEARN}\n`);
    openBrowser(URL_LEARN);
    return promptQuestion('Enter License Key after review (or press Enter to exit): ');
  }

  if (effectiveChoice === '2') {
    process.stdout.write(`Opening: ${URL_STANDARD}\n`);
    openBrowser(URL_STANDARD);
    return promptQuestion('Enter License Key after purchase: ');
  }

  if (effectiveChoice === '3') {
    process.stdout.write(`Opening: ${URL_MASTER}\n`);
    openBrowser(URL_MASTER);
    return promptQuestion('Enter License Key after purchase: ');
  }

  if (effectiveChoice === '4') {
    return promptQuestion('Enter License Key (CX-XXXX-XXXX-XXXX): ');
  }

  if (effectiveChoice === '5' && onRunAudit) {
    await onRunAudit(null, true);
  }

  if (effectiveChoice === '6') {
    process.exit(0);
  }

  return promptQuestion('Enter Chemical X Sponsor License Key (CX-XXXX-XXXX-XXXX): ');
};

export const checkOrPromptEvaluation = async (actionLabel = 'generate capsule', options = {}) => {
  const cachedKey = getCachedLicenseKey();
  if (cachedKey) {
    return { licensed: true, key: cachedKey };
  }

  const isNonInteractive = options.isYes || Boolean(process.env.CI) || !process.stdin.isTTY;
  if (isNonInteractive) {
    return { licensed: false, proceed: true };
  }

  const useGum = hasGum();
  if (useGum) {
    spawnSync(
      'gum',
      [
        'style',
        '--border=rounded',
        '--border-foreground=81',
        '--padding=0 1',
        '--bold',
        '⚡ Chemical X: Evaluation Mode (Unlicensed)\n' +
        'Support vibe coding standards: chemicalx.xophz.com\n' +
        'Single Dev ($27) | Team Power Puff ($97: Unlimited Lifetime)'
      ],
      { stdio: 'inherit' }
    );

    const choice = gumChoose(
      [
        `1. ⚡ Continue in Evaluation Mode (Press Enter to ${actionLabel})`,
        '2. 🔑 Enter License Key (Team Power Puff or Single Dev)',
        '3. 💎 Buy License ($27 Solo / $97 Team Power Puff Unlimited Lifetime)',
        '4. 🚪 Cancel'
      ],
      `Evaluation Mode: ${actionLabel}`
    );

    if (choice.startsWith('1.') || !choice) {
      return { licensed: false, proceed: true };
    }

    if (choice.startsWith('2.')) {
      const enteredKey = gumInput('License Key (CX-XXXX-XXXX-XXXX):', 'CX-XXXX-XXXX-XXXX');
      if (enteredKey && enteredKey !== 'CX-XXXX-XXXX-XXXX') {
        saveLicenseKey(enteredKey.trim().toUpperCase());
        process.stdout.write('\x1b[32m✔ License saved to ~/.chemical-x/config.json!\x1b[0m\n\n');
        return { licensed: true, key: enteredKey.trim().toUpperCase() };
      }
      return { licensed: false, proceed: true };
    }

    if (choice.startsWith('3.')) {
      openBrowser(URL_MASTER);
      process.stdout.write(`\x1b[36mOpened checkout in default browser:\x1b[0m ${URL_MASTER}\n`);
      const keyAfterBuy = gumInput('Enter License Key once purchased (or press Enter to skip):');
      if (keyAfterBuy) {
        saveLicenseKey(keyAfterBuy.trim().toUpperCase());
        process.stdout.write('\x1b[32m✔ License saved to ~/.chemical-x/config.json!\x1b[0m\n\n');
        return { licensed: true, key: keyAfterBuy.trim().toUpperCase() };
      }
      return { licensed: false, proceed: true };
    }

    if (choice.startsWith('4.')) {
      process.exit(0);
    }

    return { licensed: false, proceed: true };
  }

  process.stdout.write(
    '\n\x1b[38;5;208;1m⚡ Chemical X: Evaluation Mode (Unlicensed)\x1b[0m\n' +
    'Support vibe coding standards: chemicalx.xophz.com\n' +
    `  [1] Continue in Evaluation Mode (Press Enter to ${actionLabel})\n` +
    '  [2] Enter License Key (Team Power Puff or Single Dev)\n' +
    '  [3] Buy License ($27 Solo / $97 Team Power Puff Unlimited Lifetime)\n' +
    '  [4] Cancel\n\n'
  );

  const sel = await promptQuestion('Select option [1-4] (default: 1): ');
  const choice = sel.trim() || '1';

  if (choice === '1') {
    return { licensed: false, proceed: true };
  }

  if (choice === '2') {
    const entered = await promptQuestion('Enter License Key (CX-XXXX-XXXX-XXXX): ');
    if (entered) {
      saveLicenseKey(entered.trim().toUpperCase());
      process.stdout.write('\x1b[32m✔ License saved to ~/.chemical-x/config.json!\x1b[0m\n\n');
      return { licensed: true, key: entered.trim().toUpperCase() };
    }
    return { licensed: false, proceed: true };
  }

  if (choice === '3') {
    openBrowser(URL_MASTER);
    const entered = await promptQuestion('Enter License Key after purchase (or Enter to skip): ');
    if (entered) {
      saveLicenseKey(entered.trim().toUpperCase());
      process.stdout.write('\x1b[32m✔ License saved to ~/.chemical-x/config.json!\x1b[0m\n\n');
      return { licensed: true, key: entered.trim().toUpperCase() };
    }
    return { licensed: false, proceed: true };
  }

  if (choice === '4') {
    process.exit(0);
  }

  return { licensed: false, proceed: true };
};

export const fetchStarterKitFiles = async (licenseKey) => {
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
    const isSuccess = Boolean(res.ok && responseData.valid);

    if (!isSuccess) {
      process.stderr.write(
        `\x1b[31m✕ License Verification Failed: ${responseData.error || 'Invalid key.'}\x1b[0m\n`
      );
      process.stderr.write(`Purchase key at: ${URL_STANDARD}\n\n`);
      process.exit(1);
    }

    saveLicenseKey(normalizedKey);
    process.stdout.write(
      `\x1b[32m✔ Verified License for @${responseData.githubUser || 'sponsor'}\x1b[0m\n\n`
    );
    return responseData.files || {};
  } catch (err) {
    // Fallback: Verify with Gatekeeper or local blueprints
    const gatekeeperCheck = await verifyWithGatekeeper(normalizedKey, deviceId);
    if (gatekeeperCheck.valid) {
      saveLicenseKey(normalizedKey);
      process.stdout.write(
        `\x1b[32m✔ Verified via Gatekeeper for @${gatekeeperCheck.github_user || 'sponsor'} [Tier: ${gatekeeperCheck.tier}]\x1b[0m\n\n`
      );
      const localFiles = loadLocalBlueprintFiles();
      if (Object.keys(localFiles).length > 0) return localFiles;
    }

    process.stderr.write(
      `\x1b[31m✕ Network Error: Failed to reach edge server (${err.message}).\x1b[0m\n`
    );
    process.exit(1);
  }
};

export const loadLocalBlueprintFiles = () => {
  const blueprintsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../blueprints');
  const files = {};
  if (!fs.existsSync(blueprintsDir)) return files;

  const walk = (dir, base = '') => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
      } else {
        files[rel] = fs.readFileSync(full, 'utf-8');
      }
    }
  };
  walk(blueprintsDir);
  return files;
};

