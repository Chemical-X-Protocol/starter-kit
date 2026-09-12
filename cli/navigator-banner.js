import fs from "node:fs";
import path from "node:path";
import { getChemicalXAsciiBanner } from "./audit.js";
import { resolveGradeColor, resolveHealthHearts } from "./navigator-grades.js";

const visualWidth = (s) => {
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  let w = 0;
  for (const seg of new Intl.Segmenter().segment(stripped)) {
    const char = seg.segment;
    const isDoubleWidth = char === "❤️" || char === "🖤" || char.codePointAt(0) > 0x1f000;
    w += isDoubleWidth ? 2 : char.length;
  }
  return w;
};

const resolveProjectName = () => {
  const pkgPath = path.resolve(process.cwd(), "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      return parsed.name || path.basename(process.cwd());
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return path.basename(process.cwd()) || "Project";
    }
  }
  return path.basename(process.cwd()) || "Project";
};

const truncatePath = (p, maxLen) => (p.length <= maxLen ? p : `…${p.slice(p.length - maxLen + 1)}`);

export const renderDashboardBanner = (
  health,
  metrics,
  violations,
  critical,
  highMediumCount,
  low,
  contextAnalysis = null,
  aiSlop = null
) => {
  if (process.stdout.isTTY) console.clear();
  process.stdout.write(getChemicalXAsciiBanner(health.grade));

  const gColor = resolveGradeColor(health.grade);
  const critColor = critical.length > 0 ? "\x1b[31;1m" : "\x1b[32m";
  const highMedColor = highMediumCount > 0 ? "\x1b[38;5;208;1m" : "\x1b[32m";
  const lowColor = low.length > 0 ? "\x1b[33;1m" : "\x1b[32m";

  const hearts = resolveHealthHearts(health.grade, health.score);
  const scoreBadge = `${health.score}/100 [Grade: ${health.grade}]`;
  const labelStr = health.label ? ` (${health.label})` : "";
  const slopScore = aiSlop?.score ?? 100;
  const slopGrade = aiSlop?.grade ?? "A+";
  const slopColor = resolveGradeColor(slopGrade);
  const slopStr = aiSlop ? ` | ASI: ${slopColor}${slopScore}/100 [${slopGrade}]\x1b[0m` : "";
  const healthStr = `${hearts}  ${gColor}${scoreBadge}\x1b[0m${gColor}${labelStr}\x1b[0m${slopStr}`;

  const filesStr = `${metrics.scannedFiles} Files`;
  const locStr = `${(metrics.totalLoc || 0).toLocaleString()}`;
  const hazardsStr = `💥 ${critColor}${critical.length} Critical\x1b[0m | 🔥 ${highMedColor}${highMediumCount} High/Med\x1b[0m | 💣 ${lowColor}${low.length} Low\x1b[0m`;

  const tokens = contextAnalysis?.estimatedTokens || 0;
  const pct = contextAnalysis?.potentialSavingsPct || 0;
  const costPass = contextAnalysis?.excessCostPerPass !== undefined
    ? contextAnalysis.excessCostPerPass
    : Number((((contextAnalysis?.estimatedExcessTokens || 0) / 1000000) * 3.0).toFixed(3));
  const costMonth = contextAnalysis?.monthlyWastePerDev !== undefined
    ? contextAnalysis.monthlyWastePerDev
    : Number((costPass * 20 * 5 * 4).toFixed(2));

  const tokensStr = `~${tokens.toLocaleString()} tokens` + (pct > 0 ? ` (${pct}% cut)` : "");
  const costStr = costPass > 0
    ? `\x1b[38;5;208;1m$${costPass.toFixed(3)}\x1b[0m\x1b[2m/turn\x1b[0m | \x1b[31;1m$${costMonth.toFixed(2)}\x1b[0m\x1b[2m/mo\x1b[0m`
    : `\x1b[32;1m$0.000\x1b[0m\x1b[2m/turn\x1b[0m | \x1b[32;1m$0.00\x1b[0m\x1b[2m/mo\x1b[0m`;

  const col1 = [
    "\x1b[36;1m-FILES-\x1b[0m", `\x1b[36m${filesStr}\x1b[0m`,
    "\x1b[36;1m-LINES OF CODE-\x1b[0m", `\x1b[36m${locStr}\x1b[0m`,
    "\x1b[36;1m-TOKEN EST-\x1b[0m", `\x1b[36m${tokensStr}\x1b[0m`
  ];
  const col2 = [
    "\x1b[31;1m-HEALTH-\x1b[0m", healthStr,
    "\x1b[33;1m-HAZARDS-\x1b[0m", hazardsStr,
    "\x1b[32;1m-CURRENCY-\x1b[0m", costStr
  ];

  const col1Pad = 32;
  const rows = [];
  let maxW = 0;
  for (let i = 0; i < col1.length; i++) {
    const pad = " ".repeat(Math.max(2, col1Pad - visualWidth(col1[i])));
    const content = col1[i] + pad + col2[i];
    const w = visualWidth(content);
    if (w > maxW) maxW = w;
    rows.push({ content, width: w });
  }

  const projectName = resolveProjectName();
  const innerWidth = Math.max(maxW, visualWidth(projectName) + 4);
  const bColor = "\x1b[1;38;5;81m";
  const topBorder = `${bColor}╭── \x1b[1;37m${projectName}${bColor} ${"─".repeat(Math.max(2, innerWidth - visualWidth(projectName)))}╮\x1b[0m`;
  const displayPwd = truncatePath(process.cwd(), Math.max(10, innerWidth - 4));
  const botBorder = `${bColor}╰── \x1b[36m${displayPwd}${bColor} ${"─".repeat(Math.max(2, innerWidth - visualWidth(displayPwd)))}╯\x1b[0m`;
  const bodyLines = rows.map((r) => `${bColor}│\x1b[0m  ${r.content}${" ".repeat(innerWidth - r.width)}  ${bColor}│\x1b[0m`);

  process.stdout.write(`\n${[topBorder, ...bodyLines, botBorder].join("\n")}\n\n`);
};
