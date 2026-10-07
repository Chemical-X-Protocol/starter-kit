import fs from "node:fs";
import path from "node:path";

export const visualWidth = (s) => {
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  let w = 0;
  for (const seg of new Intl.Segmenter().segment(stripped)) {
    const char = seg.segment;
    const isDoubleWidth = char === "❤️" || char === "🖤" || char.codePointAt(0) > 0x1f000;
    w += isDoubleWidth ? 2 : char.length;
  }
  return w;
};

export const resolveProjectName = (cwd = process.cwd()) => {
  const pkgPath = path.resolve(cwd, "package.json");
  const hasPkg = fs.existsSync(pkgPath);
  if (hasPkg) {
    try {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      return parsed.name || path.basename(cwd);
    } catch {
      return path.basename(cwd) || "Project";
    }
  }
  return path.basename(cwd) || "Project";
};

export const resolveCostFigures = (contextAnalysis) => {
  const hasCostPass = contextAnalysis?.excessCostPerPass !== undefined;
  const perTurn = hasCostPass
    ? contextAnalysis.excessCostPerPass
    : Number((((contextAnalysis?.estimatedExcessTokens || 0) / 1000000) * 3.0).toFixed(3));
  const hasCostMonth = contextAnalysis?.monthlyWastePerDev !== undefined;
  const perMonth = hasCostMonth ? contextAnalysis.monthlyWastePerDev : Number((perTurn * 20 * 5 * 4).toFixed(2));
  return { perTurn, perMonth };
};

export const truncatePath = (p, maxLen) => {
  const isWithinLimit = p.length <= maxLen;
  if (isWithinLimit) return p;
  return `…${p.slice(p.length - maxLen + 1)}`;
};
