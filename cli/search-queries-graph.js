import path from 'node:path';

const isSpecOrTest = (filePath) => {
  if (!filePath || typeof filePath !== 'string') return false;
  return filePath.includes('.spec.') || filePath.includes('.test.') || filePath.includes('__tests__');
};

export const calculateBlastRadius = (db, targetPathOrSymbol, options = {}) => {
  if (!db || !targetPathOrSymbol) {
    return {
      target: targetPathOrSymbol || '',
      seedPath: '',
      totalImpactCount: 0,
      depth: 0,
      directConsumers: [],
      transitiveConsumers: [],
      impactedTests: [],
      impactedComponents: [],
      tiers: {}
    };
  }

  const cleanTarget = targetPathOrSymbol.trim();
  const maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : 5;

  let seedPath = '';
  let targetSymbolName = cleanTarget;
  const fileRow = db.prepare('SELECT path FROM files WHERE path = ? OR path LIKE ? LIMIT 1')
    .get(cleanTarget, `%${cleanTarget}%`);

  if (fileRow) {
    seedPath = fileRow.path;
  } else {
    const symRow = db.prepare('SELECT file_path, name FROM symbols WHERE name = ? LIMIT 1').get(cleanTarget);
    if (symRow) {
      seedPath = symRow.file_path;
      targetSymbolName = symRow.name;
    }
  }

  const seedBaseName = seedPath ? path.basename(seedPath).replace(/\.[^.]+$/, '') : cleanTarget;

  const querySql = `
    WITH RECURSIVE blast_tree(importer_path, depth, chain) AS (
      SELECT DISTINCT i.importer_path, 1, i.importer_path
      FROM imports i
      WHERE (i.resolved_path = ? AND i.resolved_path != '')
         OR (? != '' AND (i.source_module LIKE '%' || ? || '%' OR i.imported_symbol = ?))

      UNION

      SELECT DISTINCT i.importer_path, bt.depth + 1, bt.chain || ' -> ' || i.importer_path
      FROM imports i
      JOIN blast_tree bt ON (
        (i.resolved_path = bt.importer_path AND i.resolved_path != '')
        OR i.source_module LIKE '%' || bt.importer_path || '%'
      )
      WHERE bt.depth < ?
        AND instr(bt.chain, i.importer_path) = 0
    )
    SELECT bt.importer_path, min(bt.depth) as depth, bt.chain, COALESCE(f.tier, 'utility') as tier
    FROM blast_tree bt
    LEFT JOIN files f ON bt.importer_path = f.path
    WHERE bt.importer_path != ?
    GROUP BY bt.importer_path
    ORDER BY depth ASC, bt.importer_path ASC;
  `;

  const rows = db.prepare(querySql).all(
    seedPath,
    seedBaseName,
    seedBaseName,
    targetSymbolName,
    maxDepth,
    seedPath
  );

  const consumers = rows.map((r) => ({
    path: r.importer_path,
    depth: Number(r.depth),
    chain: r.chain,
    tier: r.tier,
    isTest: isSpecOrTest(r.importer_path)
  }));

  const directConsumers = consumers.filter((c) => c.depth === 1);
  const transitiveConsumers = consumers.filter((c) => c.depth > 1);
  const impactedTests = consumers.filter((c) => c.isTest);
  const impactedComponents = consumers.filter((c) => !c.isTest);

  const tiers = {};
  for (const c of consumers) {
    tiers[c.tier] = (tiers[c.tier] || 0) + 1;
  }

  const maxReachedDepth = consumers.reduce((acc, c) => Math.max(acc, c.depth), 0);

  return {
    target: cleanTarget,
    seedPath,
    totalImpactCount: consumers.length,
    depth: maxReachedDepth,
    directConsumers,
    transitiveConsumers,
    impactedTests,
    impactedComponents,
    tiers
  };
};
