import { createCapsuleFiles, createJigFiles, JIG_KINDS } from '../generator.js';
import { openIndexDb } from '../search-schema.js';
import { fetchScoreTrends, formatTrendReport, renderSparkline } from '../trend.js';
import { resolveTargetCwd } from './tools-search.js';

export const handleGenerateCapsule = (args = {}, cwd = process.cwd()) => {
  const { name, framework, tier = 'm', targetDir = null, lean = false, desc = '', description = '', dryRun = false } = args;

  const isJig = Boolean(args.jig || args.kind || (args.tier && JIG_KINDS.has(args.tier.toLowerCase())));
  if (isJig) {
    const kind = args.kind || (typeof args.jig === 'string' ? args.jig : null) || (args.tier && JIG_KINDS.has(args.tier.toLowerCase()) ? args.tier : 'service');
    const jigResult = createJigFiles({
      kind,
      name: (name || `sample-${kind}`).trim(),
      targetParent: targetDir,
      dir: args.dir,
      preset: args.preset,
      methods: args.methods,
      state: args.state,
      routes: args.routes,
      schema: args.schema,
      desc: desc || description,
      dryRun: Boolean(dryRun),
      cwd
    });
    return jigResult;
  }

  const hasName = Boolean(name && name.trim());
  const hasValidFramework = Boolean(framework && ['react', 'vue', 'svelte'].includes(framework.toLowerCase()));
  const canGenerate = hasName && hasValidFramework;

  if (!canGenerate) {
    throw new Error('chemx_generate_capsule requires "name" and "framework" (react, vue, svelte), or pass "jig: true" / "kind".');
  }

  const result = createCapsuleFiles({
    name: name.trim(),
    framework: framework.toLowerCase(),
    tier: tier.toLowerCase(),
    targetParent: targetDir,
    isLean: Boolean(lean),
    cwd,
    desc: desc || description,
    dryRun: Boolean(dryRun)
  });

  return {
    success: true,
    dryRun: result.dryRun,
    capsuleName: result.capsuleName,
    pascalName: result.pascalName,
    framework: result.framework,
    tier: result.tier,
    targetDir: result.targetDir,
    relativeDir: result.relativeDir,
    filesCreated: result.filesCreated,
    previews: result.previews
  };
};

export const handleChemxTrend = async (args = {}, cwd = process.cwd()) => {
  const targetCwd = resolveTargetCwd(args.cwd || cwd);
  const db = openIndexDb(targetCwd);
  const limit = args.limit || 10;
  const snapshots = fetchScoreTrends(db, limit);
  if (args.json) {
    const scores = snapshots.map((s) => s.score);
    const hasScores = snapshots.length > 0;
    const latestScore = hasScores ? snapshots[snapshots.length - 1].score : null;
    const hasDelta = snapshots.length >= 2;
    const delta = hasDelta ? snapshots[snapshots.length - 1].score - snapshots[0].score : 0;
    return {
      count: snapshots.length,
      sparkline: renderSparkline(scores),
      latestScore,
      delta,
      snapshots
    };
  }
  return formatTrendReport(snapshots);
};
