/**
 * Chemical X Protocol: Vector Delivery System (VDS) Automated Release Train
 * Implements Section 7.0 3-Week Cycle, Mid-Week Freezes & Candidate Tags
 */

import { postFeedEvent } from './team-db-feed.js';

export const parseVdsVersion = (tag = 'v2025.1.0') => {
  const match = String(tag || '').match(/^v?(\d{4})\.(\d+)\.(\d+)$/);
  if (!match) return { year: 2025, minor: 1, patch: 0 };
  return { year: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
};

export const calculateNextTrainVersion = (currentTag = 'v2025.1.0', eventType = 'midweek_freeze', date = new Date()) => {
  const { year: curYear, minor: curMinor, patch: curPatch } = parseVdsVersion(currentTag);
  const nowYear = date.getFullYear();

  const isYearRollover = eventType === 'year_rollover' || nowYear > curYear;
  if (isYearRollover) return `v${nowYear}.0.0`;

  const isSprintStart = eventType === 'sprint_start';
  if (isSprintStart) {
    const nextMinor = curMinor + 1;
    return `v${curYear}.${nextMinor}.0`;
  }

  const nextPatch = curPatch + 1;
  return `v${curYear}.${curMinor}.${nextPatch}`;
};

export const freezeReleaseTrain = (db, options = {}) => {
  const hasDb = Boolean(db);
  if (!hasDb) return { success: false, reason: 'no_db' };

  const lastTagRow = db.prepare("SELECT sprint_tag FROM agent_tasks WHERE sprint_tag != '' ORDER BY id DESC LIMIT 1").get();
  const currentTag = lastTagRow?.sprint_tag || options.baseTag || 'v2025.1.0';
  const nextVersion = calculateNextTrainVersion(currentTag, options.eventType || 'midweek_freeze', options.date || new Date());

  const candidates = db.prepare("SELECT id, title, target_path FROM agent_tasks WHERE vds_status = 'awaiting_tag' OR status = 'review'").all();
  const candidateIds = candidates.map((c) => c.id);

  if (candidateIds.length > 0) {
    const placeholders = candidateIds.map(() => '?').join(',');
    const now = Date.now();
    db.prepare(`
      UPDATE agent_tasks
      SET vds_status = 'tagged', vds_phase = 'delivery', sprint_tag = ?, updated_at = ?
      WHERE id IN (${placeholders})
    `).run(nextVersion, now, ...candidateIds);
  }

  postFeedEvent(db, {
    author_id: '@release_train',
    event_type: 'release_train_freeze',
    message: `Automated Code Freeze: Tagged candidate ${nextVersion} with ${candidateIds.length} payloads`,
    metadata: { version: nextVersion, candidateCount: candidateIds.length }
  });

  return {
    success: true,
    version: nextVersion,
    candidateCount: candidateIds.length,
    taggedIds: candidateIds
  };
};
