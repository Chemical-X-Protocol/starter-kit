/**
 * Chemical X Protocol: VDS CLI Command Handlers
 * Handles single-slot assignment, traceability permalinks, and release train freeze
 */

import { enforceSingleSlot, verifyTraceability, generateTaskPermalink } from './team-vds.js';
import { freezeReleaseTrain } from './team-release-train.js';
import { postFeedEvent } from './team-db-feed.js';

export const handleTaskSlotCommand = (db, taskId, moscow = 'must', priority = 'critical', isCli = false, isJson = false) => {
  const result = enforceSingleSlot(db, taskId, moscow, priority);
  if (isCli) {
    if (isJson) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`\x1b[32m✔\x1b[0m Task #${taskId} slotted to [${moscow.toUpperCase()} / ${priority.toUpperCase()}]\n`);
      if (result.displaced?.length > 0) {
        process.stdout.write(`\x1b[33m⚡ Displaced:\x1b[0m ${result.displaced.map((d) => `#${d.id} -> [${d.to.moscow}/${d.to.priority}]`).join(', ')}\n`);
      }
    }
  }
  return result;
};

export const handleTaskTraceCommand = (db, taskId, rawUrl, isCli = false, isJson = false) => {
  const permalink = rawUrl || generateTaskPermalink(taskId);
  const check = verifyTraceability(permalink);
  const isValid = check.valid;
  if (!isValid) {
    if (isCli) process.stderr.write(`\x1b[31m✕ Invalid traceability permalink: ${check.error}\x1b[0m\n`);
    return { success: false, error: check.error };
  }

  db.prepare('UPDATE agent_tasks SET task_url = ?, updated_at = ? WHERE id = ?').run(check.permalink, Date.now(), Number(taskId));
  postFeedEvent(db, {
    author_id: '@stream_guard',
    task_id: Number(taskId),
    event_type: 'task_traceability_anchored',
    message: `Anchored canonical task permalink: ${check.permalink}`,
    metadata: { permalink: check.permalink }
  });

  const res = { success: true, taskId: Number(taskId), permalink: check.permalink };
  if (isCli) {
    if (isJson) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    else process.stdout.write(`\x1b[32m✔\x1b[0m Task #${taskId} traceability verified: ${check.permalink}\n`);
  }
  return res;
};

export const handleTrainCommand = (db, action = 'status', options = {}, isCli = false, isJson = false) => {
  const isFreeze = action === 'freeze';
  if (isFreeze) {
    const res = freezeReleaseTrain(db, options);
    if (isCli) {
      if (isJson) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
      else process.stdout.write(`\x1b[32m✔\x1b[0m Release Train Freeze: Tagged ${res.version} (${res.candidateCount} payloads)\n`);
    }
    return res;
  }

  const lastTag = db.prepare("SELECT sprint_tag FROM agent_tasks WHERE sprint_tag != '' ORDER BY id DESC LIMIT 1").get();
  const pending = db.prepare("SELECT COUNT(*) as count FROM agent_tasks WHERE vds_status = 'awaiting_tag' OR status = 'review'").get();
  const status = { currentTag: lastTag?.sprint_tag || 'v2025.1.0', pendingCandidates: pending?.count || 0 };
  if (isCli) {
    if (isJson) process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    else process.stdout.write(`Release Train Status: Current [${status.currentTag}], Pending payloads: ${status.pendingCandidates}\n`);
  }
  return status;
};
