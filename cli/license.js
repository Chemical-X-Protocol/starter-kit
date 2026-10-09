import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  hasGum,
  gumChoose,
  gumInput,
  promptQuestion,
  openBrowser
} from './terminal.js';
import {
  resolveConfigPaths,
  readLicenseKey,
  storeLicenseKey,
  loadOrCreateDeviceId,
  ensurePrivateDir
} from './license-config.js';
import { isOfflineMode, describeOffline, resolveEndpoint, announceOverride } from './network-policy.js';
import { STATUS } from './result-status.js';

export const DEFAULT_API_BASE = 'https://chemicalx.xophz.com';
export const DEFAULT_GATEKEEPER_URL = 'https://mycompassconsulting.com/wp-json/compass/v1/gatekeeper';
export const resolveApiBase = (env = process.env) => resolveEndpoint('CHEMICAL_X_API_URL', DEFAULT_API_BASE, env);
export const resolveGatekeeperUrl = (env = process.env) => resolveEndpoint('COMPASS_GATEKEEPER_URL', DEFAULT_GATEKEEPER_URL, env);
export const URL_LEARN = 'https://chemicalx.xophz.com';
export const URL_SPONSOR = 'https://github.com/sponsors/Chemical-X-Protocol';
export const URL_STANDARD = 'https://mycompassconsulting.com/buy/chemical-x/standard';
export const URL_MASTER = 'https://mycompassconsulting.com/buy/chemical-x/master';

// Returned by the license prompts when the user picks Exit/Cancel; the CLI entry decides the exit code.
export const LICENSE_CANCELLED = Object.freeze({ cancelled: true });
export const isLicenseCancelled = (value) => value === LICENSE_CANCELLED;

export const verifyWithGatekeeper = async (keyOrUser, deviceId = null) => {
  const isOffline = isOfflineMode();
  if (isOffline) return { valid: false, offline: true, error: describeOffline('Gatekeeper license check') };
  const endpoint = resolveGatekeeperUrl();
  const isEndpointRefused = Boolean(endpoint.error);
  if (isEndpointRefused) return { valid: false, error: endpoint.error };
  announceOverride(endpoint);
  const effectiveDeviceId = deviceId || getOrCreateDeviceId();
  try {
    const res = await fetch(`${endpoint.url}/licenses/validate`, {
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
  try {
    ensurePrivateDir(resolveConfigPaths().dir);
    return true;
  } catch {
    return false;
  }
};

export const getOrCreateDeviceId = () => loadOrCreateDeviceId();

export const getCachedLicenseKey = () => readLicenseKey();

export const saveLicenseKey = (licenseKey) => {
  try {
    return storeLicenseKey(licenseKey);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    process.stderr.write(`Failed to cache license key: ${error.message}\n`);
    return { saved: false, reason: error.message, path: null };
  }
};

const persistEnteredKey = (rawKey) => {
  const normalizedKey = rawKey.trim().toUpperCase();
  const saveResult = saveLicenseKey(normalizedKey);
  if (saveResult.saved) {
    process.stdout.write(`\x1b[32m✔ License saved to ${saveResult.path} (mode 0600)\x1b[0m\n\n`);
  }
  return { licensed: true, key: normalizedKey };
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

  const isHeadless =
    rawArgs.includes('--headless') ||
    rawArgs.includes('--yes') ||
    rawArgs.includes('-y') ||
    rawArgs.includes('--ci') ||
    rawArgs.includes('--non-interactive') ||
    rawArgs.includes('--no-interactive') ||
    Boolean(process.env.CI) ||
    !process.stdout?.isTTY ||
    !process.stdin?.isTTY ||
    process.env.TERM === 'dumb' ||
    Boolean(process.argv?.some((arg) => arg === '--headless' || arg === '--ci' || arg === '--yes' || arg === '-y' || arg === '--non-interactive'));

  if (isHeadless) {
    return null;
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
      return LICENSE_CANCELLED;
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
    return LICENSE_CANCELLED;
  }

  return promptQuestion('Enter Chemical X Sponsor License Key (CX-XXXX-XXXX-XXXX): ');
};

export const checkOrPromptEvaluation = async (actionLabel = 'generate capsule', options = {}) => {
  const cachedKey = getCachedLicenseKey();
  if (cachedKey) {
    return { licensed: true, key: cachedKey };
  }

  const isNonInteractive =
    options.isYes ||
    Boolean(process.env.CI) ||
    process.stdin?.isTTY === false ||
    process.stdout?.isTTY === false ||
    Boolean(process.argv?.some((arg) => arg === '--headless' || arg === '--yes' || arg === '-y' || arg === '--ci' || arg === '--non-interactive'));
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
        return persistEnteredKey(enteredKey);
      }
      return { licensed: false, proceed: true };
    }

    if (choice.startsWith('3.')) {
      openBrowser(URL_MASTER);
      process.stdout.write(`\x1b[36mOpened checkout in default browser:\x1b[0m ${URL_MASTER}\n`);
      const keyAfterBuy = gumInput('Enter License Key once purchased (or press Enter to skip):');
      if (keyAfterBuy) {
        return persistEnteredKey(keyAfterBuy);
      }
      return { licensed: false, proceed: true };
    }

    if (choice.startsWith('4.')) {
      return { licensed: false, proceed: false, cancelled: true };
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
      return persistEnteredKey(entered);
    }
    return { licensed: false, proceed: true };
  }

  if (choice === '3') {
    openBrowser(URL_MASTER);
    const entered = await promptQuestion('Enter License Key after purchase (or Enter to skip): ');
    if (entered) {
      return persistEnteredKey(entered);
    }
    return { licensed: false, proceed: true };
  }

  if (choice === '4') {
    return { licensed: false, proceed: false, cancelled: true };
  }

  return { licensed: false, proceed: true };
};

const failDownload = (reason) => {
  process.stderr.write(`\x1b[31m✕ ${reason}\x1b[0m\n`);
  return { status: STATUS.FAIL, files: {}, reason };
};

const requestStarterKit = async (baseUrl, licenseKey, deviceId) => {
  try {
    const res = await fetch(`${baseUrl}/api/starter-kit/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey, deviceId })
    });
    const data = await res.json();
    return [{ ok: res.ok, data }, null];
  } catch (err) {
    return [null, err instanceof Error ? err : new Error(String(err))];
  }
};

const verifyViaGatekeeperFallback = async (licenseKey, deviceId, networkError) => {
  const gatekeeperCheck = await verifyWithGatekeeper(licenseKey, deviceId);
  if (gatekeeperCheck.valid) {
    saveLicenseKey(licenseKey);
    process.stdout.write(
      `\x1b[32m✔ Verified via Gatekeeper for @${gatekeeperCheck.github_user || 'sponsor'} [Tier: ${gatekeeperCheck.tier}]\x1b[0m\n\n`
    );
    const localFiles = loadLocalBlueprintFiles();
    const hasLocalFiles = Object.keys(localFiles).length > 0;
    if (hasLocalFiles) return { status: STATUS.PASS, files: localFiles, reason: null };
  }
  return failDownload(`Network Error: Failed to reach edge server (${networkError.message}).`);
};

// Returns { status, files, reason }; never exits. Offline mode falls back to the bundled blueprints.
export const fetchStarterKitFiles = async (licenseKey) => {
  const normalizedKey = licenseKey.trim().toUpperCase();
  const isOffline = isOfflineMode();
  if (isOffline) {
    const reason = describeOffline('License verification and starter-kit download');
    process.stderr.write(`${reason}\nUsing the bundled Community blueprints instead.\n`);
    return { status: STATUS.INCONCLUSIVE, files: loadLocalBlueprintFiles(), reason, offline: true };
  }
  const endpoint = resolveApiBase();
  const isEndpointRefused = Boolean(endpoint.error);
  if (isEndpointRefused) return failDownload(endpoint.error);
  announceOverride(endpoint);

  const deviceId = getOrCreateDeviceId();
  process.stdout.write(`\nVerifying license via edge: ${endpoint.url}...\n`);
  const [response, networkError] = await requestStarterKit(endpoint.url, normalizedKey, deviceId);
  if (networkError) return verifyViaGatekeeperFallback(normalizedKey, deviceId, networkError);

  const isSuccess = Boolean(response.ok && response.data && response.data.valid);
  if (!isSuccess) {
    const detail = (response.data && response.data.error) || 'Invalid key.';
    process.stderr.write(`Purchase key at: ${URL_STANDARD}\n`);
    return failDownload(`License Verification Failed: ${detail}`);
  }
  saveLicenseKey(normalizedKey);
  process.stdout.write(`\x1b[32m✔ Verified License for @${response.data.githubUser || 'sponsor'}\x1b[0m\n\n`);
  return { status: STATUS.PASS, files: response.data.files || {}, reason: null };
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

