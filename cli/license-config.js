// License config storage: XDG location, private permissions, CI env key, device id.
// Paths are resolved per call from the environment so tests and CI can redirect them.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;
export const CONFIG_FILE_NAME = 'config.json';
export const DEVICE_FILE_NAME = 'device_id';
export const LICENSE_ENV_VAR = 'CHEMX_LICENSE_KEY';

const homeDir = (env) => env.HOME || os.homedir();

// $XDG_CONFIG_HOME/chemx, default ~/.config/chemx. The XDG spec ignores relative values.
export const resolveConfigDir = (env = process.env) => {
  const xdg = typeof env.XDG_CONFIG_HOME === 'string' ? env.XDG_CONFIG_HOME.trim() : '';
  const hasAbsoluteXdg = xdg.length > 0 && path.isAbsolute(xdg);
  const base = hasAbsoluteXdg ? xdg : path.join(homeDir(env), '.config');
  return path.join(base, 'chemx');
};

export const resolveLegacyConfigDir = (env = process.env) => path.join(homeDir(env), '.chemical-x');

export const resolveConfigPaths = (env = process.env) => {
  const dir = resolveConfigDir(env);
  return { dir, configFile: path.join(dir, CONFIG_FILE_NAME), deviceFile: path.join(dir, DEVICE_FILE_NAME) };
};

export const ensurePrivateDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  fs.chmodSync(dir, DIR_MODE);
};

// Writes through a 0600 temp file and renames, so the content is never world-readable.
export const writePrivateFile = (filePath, content) => {
  ensurePrivateDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, content, { encoding: 'utf-8', mode: FILE_MODE });
  fs.chmodSync(tempPath, FILE_MODE);
  fs.renameSync(tempPath, filePath);
};

const readTrimmed = (filePath) => {
  try { return fs.readFileSync(filePath, 'utf-8').trim(); } catch { return ''; }
};

// One-time move from ~/.chemical-x: copy what the new dir lacks with private modes, then delete the old copy.
export const migrateLegacyConfig = (env = process.env) => {
  const legacyDir = resolveLegacyConfigDir(env);
  const { dir } = resolveConfigPaths(env);
  const hasLegacyDir = fs.existsSync(legacyDir);
  if (!hasLegacyDir) return { migrated: [], removedLegacyDir: false };
  const migrated = [];
  for (const name of [CONFIG_FILE_NAME, DEVICE_FILE_NAME]) {
    const legacyFile = path.join(legacyDir, name);
    const targetFile = path.join(dir, name);
    const hasLegacyFile = fs.existsSync(legacyFile);
    if (!hasLegacyFile) continue;
    const isTargetMissing = !fs.existsSync(targetFile);
    if (isTargetMissing) {
      writePrivateFile(targetFile, fs.readFileSync(legacyFile, 'utf-8'));
      migrated.push(name);
    }
    fs.rmSync(legacyFile, { force: true });
  }
  const isLegacyEmpty = fs.readdirSync(legacyDir).length === 0;
  if (isLegacyEmpty) fs.rmdirSync(legacyDir);
  return { migrated, removedLegacyDir: isLegacyEmpty };
};

const migrateQuietly = (env) => {
  try { migrateLegacyConfig(env); } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`chemx: could not migrate ~/.chemical-x config: ${message}\n`);
  }
};

export const readEnvLicenseKey = (env = process.env) => {
  const raw = typeof env[LICENSE_ENV_VAR] === 'string' ? env[LICENSE_ENV_VAR].trim() : '';
  return raw.length > 0 ? raw : null;
};

// Env key first (CI), then the stored key. The env key is never written to disk.
export const readLicenseKey = (env = process.env) => {
  const envKey = readEnvLicenseKey(env);
  if (envKey) return envKey;
  migrateQuietly(env);
  const stored = readTrimmed(resolveConfigPaths(env).configFile);
  if (!stored) return null;
  try { return JSON.parse(stored).licenseKey || null; } catch { return null; }
};

export const isEnvLicenseKey = (licenseKey, env = process.env) => {
  const envKey = readEnvLicenseKey(env);
  const hasEnvKey = Boolean(envKey && licenseKey);
  return hasEnvKey && envKey.toUpperCase() === String(licenseKey).trim().toUpperCase();
};

export const storeLicenseKey = (licenseKey, env = process.env) => {
  const isFromEnv = isEnvLicenseKey(licenseKey, env);
  if (isFromEnv) return { saved: false, reason: `${LICENSE_ENV_VAR} is never persisted`, path: null };
  const { configFile } = resolveConfigPaths(env);
  const payload = JSON.stringify({ licenseKey, updatedAt: new Date().toISOString() }, null, 2);
  writePrivateFile(configFile, payload);
  return { saved: true, reason: null, path: configFile };
};

// Existing ids (including legacy cli_* ids) are kept; new ids are random UUIDs.
export const loadOrCreateDeviceId = (env = process.env) => {
  migrateQuietly(env);
  const { deviceFile } = resolveConfigPaths(env);
  const existing = readTrimmed(deviceFile);
  if (existing) return existing;
  const newId = crypto.randomUUID();
  try {
    writePrivateFile(deviceFile, newId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`chemx: could not save device id: ${message}\n`);
  }
  return newId;
};
