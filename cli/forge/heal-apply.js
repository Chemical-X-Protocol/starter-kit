// The heal itself (engine doc, Heal: SAFETY SEQUENCE): plan in memory, lease every path or none, take the
// typecheck baseline, write through applyEdits, verify, and roll back to byte-identical files on any
// failure. A dry run plans, previews the diff and reports the in-memory audit and post-condition without
// leasing or writing. Every attempt is a heal_runs row. Heal never commits; the owning session does.
import fs from 'node:fs';
import path from 'node:path';
import { applyEdits, EditRefusedError } from '../apply-edits.js';
import { ensureFresh } from '../index-freshness.js';
import { fingerprintFile } from './fingerprint-file.js';
import { HealError, fileHashOf } from './heal-text.js';
import { planHeal } from './heal-plan.js';
import { acquireAll, releaseTaken, foreignLeases } from './heal-leases.js';
import { verifyHeal, scopedBaseline, auditStage, postCondition } from './heal-verify.js';
import { typecheckCoverage } from './heal-typecheck.js';
import { chemxTestRunner } from './heal-specs.js';
import { recordHealRun, setBlueprintStatus, tailLines } from './heal-store.js';

const readerAt = (root) => (relative) => {
  try {
    return fs.readFileSync(path.join(root, relative), 'utf-8');
  } catch {
    return null; // a missing member file is reported by the staleness check as BLUEPRINT_STALE
  }
};

const unique = (list) => [...new Set(list)];

const editsOf = (plan) => plan.files.map((file) => ({ path: file.file, content: file.after }));

const restoreEditsOf = (plan) => plan.files.map((file) => (file.created ? { path: file.file, delete: true } : { path: file.file, content: file.before, allowRemoved: true }));

const fileReceipts = (plan) => plan.files.map((file) => ({
  file: file.file, created: file.created, before: file.before, beforeSha: file.before === null ? null : fileHashOf(file.before), afterSha: fileHashOf(file.after)
}));

/** True when every plan file is byte-identical to its before state (a created file is gone again). */
export const isRestored = (root, files) => files.every((file) => {
  const absolute = path.join(root, file.file);
  const exists = fs.existsSync(absolute);
  return file.created ? !exists : exists && fs.readFileSync(absolute, 'utf-8') === file.before;
});

const syncIndexes = (root, files) => {
  for (const file of files) {
    const absolute = path.join(root, file.file);
    try {
      ensureFresh(root, { paths: [absolute], scope: false });
    } catch {
      // chemx-allow: best-effort the search index is a cache; the next chemx q re-syncs a stale file
    }
    fingerprintFile(absolute, root);
  }
};

const refusal = (db, blueprint, agentId, error, extra = {}) => {
  const runId = recordHealRun(db, { blueprintId: blueprint.id, agent: agentId, outcome: 'refused', stage: 'plan', code: error.code, output: error.message });
  return { outcome: 'refused', code: error.code, message: error.message, runId, ...extra };
};

const asHealError = (error) => {
  const isHeal = error instanceof HealError;
  if (isHeal) return error;
  const isRefusedEdit = error instanceof EditRefusedError;
  const code = isRefusedEdit && /locked by/.test(error.message) ? 'CHEMX_FILE_LOCKED' : 'HEAL_EDIT_REFUSED';
  return isRefusedEdit ? new HealError(code, error.message) : null;
};

const dryRun = (db, blueprint, plan, { root, agentId }) => {
  const preview = applyEdits(editsOf(plan), { cwd: root, dryRun: true, agentId });
  const audit = auditStage(root, plan.files);
  const post = postCondition(plan, blueprint.callSites.map((site) => site.memberFp));
  const leases = foreignLeases(root, unique([...blueprint.locks, ...plan.files.map((file) => file.file)]), agentId);
  const runId = recordHealRun(db, { blueprintId: blueprint.id, agent: agentId, outcome: 'dry_run', verify: { audit, post }, diff: preview.diff });
  return { outcome: 'dry_run', runId, diff: preview.diff, plan, audit, post, foreignLeases: leases };
};

const rollBack = (root, plan, agentId) => {
  try {
    applyEdits(restoreEditsOf(plan), { cwd: root, agentId });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: isRestored(root, plan.files), error: null };
};

const failedOutput = (verify) => {
  const failed = verify.stages.find((stage) => !stage.ok);
  return tailLines([failed?.detail ?? '', failed?.output ?? ''].filter(Boolean).join('\n'));
};

const finishFailure = (db, blueprint, plan, verify, { root, agentId, leases }) => {
  const restored = rollBack(root, plan, agentId);
  const outcome = restored.ok ? 'rolled_back' : 'rollback_failed';
  const output = restored.ok ? failedOutput(verify) : `${failedOutput(verify)}\nrollback failed: ${restored.error ?? 'files differ from their before state'}`;
  const runId = recordHealRun(db, { blueprintId: blueprint.id, agent: agentId, outcome, stage: verify.stage, output, verify, files: fileReceipts(plan) });
  setBlueprintStatus(db, blueprint.id, 'rejected');
  releaseTaken(root, leases.taken, agentId);
  return { outcome, runId, stage: verify.stage, output, verify, plan };
};

const finishSuccess = (db, blueprint, plan, verify, written, { root, agentId, leases }) => {
  syncIndexes(root, plan.files);
  const runId = recordHealRun(db, { blueprintId: blueprint.id, agent: agentId, outcome: 'applied', verify, files: fileReceipts(plan), diff: written.diff });
  setBlueprintStatus(db, blueprint.id, 'healed');
  return { outcome: 'applied', runId, diff: written.diff, verify, plan, leases };
};

// A stage that throws is a failed stage: the files are written by now, so they must be rolled back.
const verifySafely = async (input) => {
  try {
    return await verifyHeal(input);
  } catch (error) {
    const detail = `verify threw: ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, stage: 'verify', stages: [{ stage: 'verify', ok: false, detail }] };
  }
};

const applyAndVerify = async (db, blueprint, plan, options) => {
  const { root, agentId } = options;
  const leases = acquireAll(root, unique([...blueprint.locks, ...plan.files.map((file) => file.file)]), { agentId, purpose: options.purpose ?? `heal ${blueprint.id}` });
  const existing = plan.files.filter((file) => !file.created).map((file) => file.file);
  const baseline = await scopedBaseline(root, typecheckCoverage(root, existing), { checkerRoot: options.checkerRoot });
  let written = null;
  try {
    written = applyEdits(editsOf(plan), { cwd: root, agentId });
  } catch (error) {
    releaseTaken(root, leases.taken, agentId);
    throw error;
  }
  const verify = await verifySafely({
    root, plan, memberFps: blueprint.callSites.map((site) => site.memberFp), baseline,
    options: { runSpecs: options.runSpecs ?? chemxTestRunner, checkerRoot: options.checkerRoot, specDepth: options.specDepth, directSpecs: blueprint.verify?.specs?.direct ?? [] }
  });
  const context = { root, agentId, leases };
  return verify.ok ? finishSuccess(db, blueprint, plan, verify, written, context) : finishFailure(db, blueprint, plan, verify, context);
};

/**
 * Heals one blueprint. options: { root, db (index db for heal_runs), agentId ('@handle'), fills (Map),
 * dryRun, runSpecs, checkerRoot (where tsc is found), specDepth, purpose }. Returns { outcome, runId, ... }
 * where outcome is dry_run, refused, applied, rolled_back or rollback_failed.
 */
export const runHeal = async (blueprint, options) => {
  const { db, root } = options;
  const agentId = options.agentId ?? '';
  const isAnonymous = !options.dryRun && !agentId.startsWith('@');
  if (isAnonymous) return refusal(db, blueprint, agentId, new HealError('HEAL_NO_HANDLE', 'a heal takes leases; pass --as=@handle'));
  try {
    const plan = planHeal(blueprint, { fills: options.fills ?? new Map(), readFile: readerAt(root) });
    return options.dryRun ? dryRun(db, blueprint, plan, { root, agentId }) : await applyAndVerify(db, blueprint, plan, { ...options, agentId });
  } catch (error) {
    const healError = asHealError(error);
    if (!healError) throw error;
    return refusal(db, blueprint, agentId, healError, { files: healError.details?.files ?? [] });
  }
};
