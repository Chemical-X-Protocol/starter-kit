import { calculateBlastRadius } from './search-queries-graph.js';

export const calculateCascadingHotspotGraph = (db, options = {}) => {
  const isValidDb = Boolean(db);
  if (!isValidDb) return { count: 0, hotspots: [] };

  const limit = options.limit || 10;
  const sql = `
    SELECT
      v.file_path,
      COALESCE(f.tier, 'utility') as tier,
      COALESCE(f.lines, 0) as lines,
      COUNT(v.id) as total_violations,
      SUM(CASE WHEN v.severity = 'CRITICAL' THEN 1 ELSE 0 END) as critical_count,
      SUM(CASE WHEN v.severity = 'HIGH' THEN 1 ELSE 0 END) as high_count,
      SUM(CASE WHEN v.severity = 'MEDIUM' THEN 1 ELSE 0 END) as med_count,
      SUM(CASE WHEN v.severity = 'LOW' THEN 1 ELSE 0 END) as low_count
    FROM violations v
    LEFT JOIN files f ON v.file_path = f.path
    GROUP BY v.file_path
    HAVING total_violations > 0
  `;

  const rows = db.prepare(sql).all();
  const hotspots = [];

  for (const r of rows) {
    const blast = calculateBlastRadius(db, r.file_path);
    const critical = Number(r.critical_count || 0);
    const high = Number(r.high_count || 0);
    const med = Number(r.med_count || 0);
    const low = Number(r.low_count || 0);

    const severityWeight = critical * 8 + high * 4 + med * 2 + low;
    const impactMultiplier = 1 + blast.totalImpactCount;
    const cascadingRisk = severityWeight * impactMultiplier;

    hotspots.push({
      filePath: r.file_path,
      tier: r.tier,
      lines: Number(r.lines || 0),
      totalViolations: Number(r.total_violations),
      criticalCount: critical,
      highCount: high,
      medCount: med,
      lowCount: low,
      severityWeight,
      blastRadius: {
        totalImpact: blast.totalImpactCount,
        depth: blast.depth,
        directConsumers: blast.directConsumers.length,
        impactedTests: blast.impactedTests.length
      },
      cascadingRisk
    });
  }

  hotspots.sort((h1, h2) => h2.cascadingRisk - h1.cascadingRisk);
  const capped = hotspots.slice(0, limit);

  return {
    count: hotspots.length,
    hotspots: capped
  };
};
