// Doctor checks for the kit itself: which commit runs on this machine, how far that checkout is from
// origin/main, and which chemx version the project's CI workflows pin. These three facts explain why
// a local audit and CI can disagree: the chemx on PATH may be ahead of what `npx chemx@<pin>` runs.
// Read-only: no network unless `--fetch` is passed, and a failed fetch is reported, not failed on.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { STATUS } from '../result-status.js';
import { KIT_ROOT } from '../hooks/launcher.js';
import { realPathOrSelf } from './kit-locate.js';

const WORKFLOWS_DIR = path.join('.github', 'workflows');
const WORKFLOW_FILE = /\.ya?ml$/;
const ENV_PIN = /^\s*(?:-\s*)?CHEMX_VERSION\s*:\s*["']?(\d[\w.+-]*)["']?\s*(?:#.*)?$/m;
const NPX_PIN = /\bchemx@(\d[\w.+-]*)/;
const GIT_TIMEOUT_MS = 5000;
const FETCH_TIMEOUT_MS = 15000;

const gitText = (args, cwd, timeout = GIT_TIMEOUT_MS) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8', timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const isOk = result.status === 0;
  const reason = (result.stderr ?? '').trim().split('\n')[0] || result.error?.message || `exit ${result.status}`;
  return { ok: isOk, text: (result.stdout ?? '').trim(), reason };
};

// The kit root must be the top of its own git checkout: an installed copy under node_modules of
// another repo is not a checkout of the kit, whatever HEAD of the enclosing repo says.
const isOwnCheckout = (kitRoot) => {
  const top = gitText(['rev-parse', '--show-toplevel'], kitRoot);
  return top.ok && realPathOrSelf(top.text) === realPathOrSelf(kitRoot);
};

export const readCiPins = (projectRoot) => {
  const dir = path.join(projectRoot, WORKFLOWS_DIR);
  const hasDir = fs.existsSync(dir);
  if (!hasDir) return [];
  const pins = [];
  for (const name of fs.readdirSync(dir).filter((entry) => WORKFLOW_FILE.test(entry)).sort()) {
    const text = fs.readFileSync(path.join(dir, name), 'utf-8');
    const match = text.match(ENV_PIN) ?? text.match(NPX_PIN);
    if (match) pins.push({ file: path.join(WORKFLOWS_DIR, name), version: match[1] });
  }
  return pins;
};

export const checkCiPin = ({ projectRoot, cliVersion }) => {
  const pins = readCiPins(projectRoot);
  const hasNoPin = pins.length === 0;
  if (hasNoPin) return { id: 'ci-pin', status: STATUS.PASS, summary: `no CHEMX_VERSION pin in ${WORKFLOWS_DIR}` };
  const differing = pins.filter((pin) => pin.version !== cliVersion);
  const listing = pins.map((pin) => `chemx@${pin.version} (${pin.file})`).join(', ');
  const isInStep = differing.length === 0;
  if (isInStep) return { id: 'ci-pin', status: STATUS.PASS, summary: `CI pins ${listing}, same as this kit`, details: pins };
  const first = differing[0].version;
  const summary = `CI pins ${listing}, this kit is ${cliVersion}: results can differ; check with npx chemx@${first} or bump CHEMX_VERSION`;
  return { id: 'ci-pin', status: STATUS.FAIL, summary, details: pins };
};

const installedCopy = (id, cliVersion, kitRoot) => ({
  id,
  status: STATUS.PASS,
  summary: id === 'kit' ? `kit ${cliVersion} (installed copy, not a git checkout) at ${kitRoot}` : 'n/a (installed copy, not a git checkout)',
});

export const checkKit = ({ kitRoot = KIT_ROOT, cliVersion }) => {
  const sha = isOwnCheckout(kitRoot) ? gitText(['rev-parse', '--short=7', 'HEAD'], kitRoot) : null;
  const hasCommit = Boolean(sha?.ok);
  if (!hasCommit) return installedCopy('kit', cliVersion, kitRoot);
  const branch = gitText(['symbolic-ref', '--short', '-q', 'HEAD'], kitRoot);
  const modified = gitText(['status', '--porcelain', '--untracked-files=no'], kitRoot).text.split('\n').filter(Boolean).length;
  const branchNote = branch.ok ? `on ${branch.text}` : 'on a detached HEAD';
  const dirtyNote = modified > 0 ? `, ${modified} modified` : '';
  return { id: 'kit', status: STATUS.PASS, summary: `kit ${cliVersion} @ ${sha.text} ${branchNote}${dirtyNote}`, details: { kitRoot, commit: sha.text, modified } };
};

const driftStatus = ({ ahead, behind, fetchFailed }) => {
  const isBehind = behind > 0;
  const isUnproven = ahead > 0 || fetchFailed;
  if (isBehind) return STATUS.FAIL;
  return isUnproven ? STATUS.INCONCLUSIVE : STATUS.PASS;
};

const driftAdvice = ({ ahead, behind }) => {
  const isDiverged = ahead > 0 && behind > 0;
  const isBehind = behind > 0;
  const isAhead = ahead > 0;
  if (isDiverged) return '; diverged: rebase or merge origin/main';
  if (isBehind) return '; git pull --ff-only';
  return isAhead ? '; commits here are not on origin, so CI and npx run something else' : '';
};

export const checkKitOrigin = ({ kitRoot = KIT_ROOT, isFetch = false }) => {
  if (!isOwnCheckout(kitRoot)) return installedCopy('kit-origin');
  const fetch = isFetch ? gitText(['fetch', '--quiet', 'origin', 'main'], kitRoot, FETCH_TIMEOUT_MS) : null;
  const fetchFailed = Boolean(fetch && !fetch.ok);
  const counts = gitText(['rev-list', '--left-right', '--count', 'HEAD...origin/main'], kitRoot);
  const failNote = fetchFailed ? `; fetch failed: ${fetch.reason}` : '';
  if (!counts.ok) return { id: 'kit-origin', status: STATUS.INCONCLUSIVE, summary: `no origin/main ref to compare with (git fetch origin main)${failNote}` };
  const [ahead, behind] = counts.text.split(/\s+/).map(Number);
  const isInStep = ahead === 0 && behind === 0;
  const position = isInStep ? 'in step with origin/main' : `${ahead} ahead, ${behind} behind origin/main`;
  const source = isFetch && !fetchFailed ? ' (fetched)' : ' (local ref)';
  const summary = `${position}${source}${driftAdvice({ ahead, behind })}${failNote}`;
  return { id: 'kit-origin', status: driftStatus({ ahead, behind, fetchFailed }), summary, details: { ahead, behind, fetchFailed } };
};
