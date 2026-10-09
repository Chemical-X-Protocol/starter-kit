/**
 * Chemical X Protocol: repo-aware task ids (#2488).
 * After a merge renumbered a repo's tasks, task_aliases maps (source_repo, old_id) -> new_id.
 * The rule for "#N" typed in repo R:
 *   - R has an alias for N: #N is that repo's task (alias.new_id);
 *   - otherwise #N is the coordination db's own task N.
 * When N names more than one task across repos the lookup is ambiguous: the rule above still picks
 * one, and the result lists every candidate so the caller can say so. Free text is never rewritten;
 * this lookup is what keeps old references like #1980 resolvable.
 */

const ID_PATTERN = /^#?(\d+)$/;

const safeAll = (db, sql, params) => {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return []; // chemx-allow: best-effort a db without task_aliases (never merged) has no aliases
  }
};

export const parseTaskNumber = (raw) => {
  const match = ID_PATTERN.exec(String(raw ?? '').trim());
  return match ? Number(match[1]) : null;
};

const directCandidate = (db, number) => {
  const row = safeAll(db, 'SELECT id, repo, title FROM agent_tasks WHERE id = ?', [number])[0];
  return row ? { id: row.id, repo: row.repo ?? '.', title: row.title, via: 'direct' } : null;
};

const aliasCandidates = (db, number) => safeAll(db, `
  SELECT a.source_repo AS alias_repo, a.new_id AS id, t.repo AS repo, t.title AS title
  FROM task_aliases a LEFT JOIN agent_tasks t ON t.id = a.new_id
  WHERE a.old_id = ?
`, [number]).map((row) => ({ id: row.id, repo: row.repo ?? row.alias_repo, aliasRepo: row.alias_repo, title: row.title, via: 'alias' }));

const describeCandidate = (candidate, number) => {
  const isAlias = candidate.via === 'alias';
  const origin = isAlias ? `#${number} of repo ${candidate.aliasRepo}, now #${candidate.id}` : `#${candidate.id} (repo ${candidate.repo})`;
  return `${origin}: ${candidate.title ?? '(missing)'}`;
};

const buildNotice = (chosen, candidates, number) => {
  const others = candidates.filter((candidate) => candidate !== chosen);
  const isAmbiguous = others.length > 0;
  if (!isAmbiguous) return null;
  const listed = candidates.map((candidate) => `  ${candidate === chosen ? '*' : '-'} ${describeCandidate(candidate, number)}`).join('\n');
  const lead = chosen
    ? `#${number} is ambiguous across repos; using the starred one (an alias in this repo wins, else the board's own #${number})`
    : `#${number} is not a task in this repo or on the board; other repos had a #${number} before the merge (use the new id)`;
  return `${lead}:\n${listed}`;
};

/**
 * @param {object} db team db
 * @param {string|number} raw '#123' or '123'
 * @param {{ repo?: string }} [context] the caller's repo ('.' = the coordination root)
 * @returns {{ id: number|null, via: string|null, notice: string|null, candidates: object[] }}
 */
export const resolveTaskRef = (db, raw, context = {}) => {
  const number = parseTaskNumber(raw);
  const isNumber = number !== null;
  if (!isNumber) return { id: null, via: null, notice: null, candidates: [] };
  const repo = context.repo || '.';
  const aliases = aliasCandidates(db, number);
  const direct = directCandidate(db, number);
  const candidates = [...aliases, direct].filter(Boolean);
  const ownAlias = aliases.find((candidate) => candidate.aliasRepo === repo);
  const chosen = ownAlias || direct;
  const id = chosen ? chosen.id : number;
  return { id, via: chosen?.via ?? 'direct', notice: buildNotice(chosen, candidates, number), candidates };
};
