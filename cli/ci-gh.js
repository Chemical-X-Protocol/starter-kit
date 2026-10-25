/**
 * Chemical X Protocol: the one module that spawns gh for `chemx ci` (#6760, K15). Callers take a
 * runner with this signature (`gh(args) -> { ok, code, stdout, stderr, missing }`) so specs pass a
 * stand-in. It never throws: a missing gh, a timeout and a non-zero exit all come back as a result.
 */
import { spawnSync } from 'node:child_process';
import { toResultSync } from './audit/rules-helpers.js';

const GH_TIMEOUT_MS = 60000;
const MAX_BUFFER = 8 * 1024 * 1024;

/**
 * @param {string[]} args arguments after `gh`
 * @param {{ cwd?: string, env?: object }} [options]
 * @returns {{ ok: boolean, code: number|null, stdout: string, stderr: string, missing: boolean }}
 */
export const runGh = (args, options = {}) => {
  const { cwd = process.cwd(), env = process.env } = options;
  const result = spawnSync('gh', args, { cwd, env, encoding: 'utf8', timeout: GH_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
  const isMissing = result.error?.code === 'ENOENT';
  const fallback = result.error ? String(result.error.message) : '';
  return { ok: result.status === 0, code: result.status, stdout: result.stdout || '', stderr: result.stderr || fallback, missing: isMissing };
};

/** The parsed JSON of a gh reply's stdout, or null when it is empty or not JSON. */
export const jsonOf = (reply) => {
  const [value] = toResultSync(() => JSON.parse(reply.stdout));
  return value;
};

/** The first line gh said on failure, without its "gh: " prefix, for a one-line error. */
export const firstLine = (reply) => {
  const text = (reply.stderr || reply.stdout || '').trim();
  const line = text.split('\n')[0] || `exit ${reply.code}`;
  return line.replace(/^gh: /, '');
};

export const MISSING_GH = 'gh is not installed or not on PATH (https://cli.github.com); chemx ci reads GitHub through it';
