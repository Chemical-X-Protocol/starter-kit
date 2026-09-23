/**
 * Chemical X Protocol: Project Memory & Heuristics Engine
 * Tracks verified architectural heuristics and compounds learnings over time
 */

export const recordVerifiedLearning = (db, learning = {}) => {
  if (!db) return null;
  const {
    projectId = null,
    tier = 'general',
    pattern,
    ruleText,
    rationale = '',
    provenancePath = ''
  } = learning;

  const hasPattern = Boolean(pattern);
  const hasRuleText = Boolean(ruleText);
  const isValidLearning = hasPattern && hasRuleText;
  if (!isValidLearning) return null;

  const now = Date.now();
  const existing = db.prepare('SELECT id, verified_count FROM project_learnings WHERE pattern = ?').get(pattern);

  if (existing) {
    db.prepare('UPDATE project_learnings SET verified_count = verified_count + 1, updated_at = ? WHERE id = ?').run(now, existing.id);
    return { id: existing.id, pattern, verified_count: existing.verified_count + 1, updated: true };
  }

  const res = db.prepare(`
    INSERT INTO project_learnings (project_id, tier, pattern, rule_text, rationale, verified_count, provenance_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(projectId, tier, pattern, ruleText, rationale, provenancePath, now, now);

  return { id: Number(res.lastInsertRowid), pattern, verified_count: 1, created: true };
};

export const queryRelevantLearnings = (db, options = {}) => {
  if (!db) return [];
  const { tier, limit = 3 } = options;
  if (tier && tier !== 'all') {
    return db.prepare(`
      SELECT id, tier, pattern, rule_text, rationale, verified_count, provenance_path
      FROM project_learnings
      WHERE tier = ? OR tier = 'general'
      ORDER BY verified_count DESC, updated_at DESC
      LIMIT ?
    `).all(tier, limit);
  }
  return db.prepare(`
    SELECT id, tier, pattern, rule_text, rationale, verified_count, provenance_path
    FROM project_learnings
    ORDER BY verified_count DESC, updated_at DESC
    LIMIT ?
  `).all(limit);
};

export const formatLearningsCard = (learnings = []) => {
  if (!learnings.length) return '  (No compounding learnings recorded yet.)\n';
  const lines = [''];
  lines.push('\x1b[1m\x1b[36m🧠 [Chemical X] Compounded Codebase Memory\x1b[0m');
  lines.push(`\x1b[90m${'─'.repeat(54)}\x1b[0m`);
  for (const l of learnings) {
    lines.push(`  \x1b[32m✔\x1b[0m \x1b[1m[${l.tier.toUpperCase()}]\x1b[0m \x1b[33m${l.pattern}\x1b[0m (verified ${l.verified_count}x)`);
    lines.push(`    \x1b[90mRule:\x1b[0m ${l.rule_text}`);
    if (l.provenance_path) lines.push(`    \x1b[90mSrc:\x1b[0m  ${l.provenance_path}`);
  }
  lines.push(`\x1b[90m${'─'.repeat(54)}\x1b[0m\n`);
  return lines.join('\n');
};
