import path from 'node:path';
import {
  CYAN,
  GREEN,
  YELLOW,
  RED,
  ORANGE,
  DIM,
  BOLD,
  RESET,
  resolveTopSectionColor
} from './reporter-utils.js';

export const resolveDirectory = (filePath) => {
  const hasFilePath = Boolean(filePath);
  if (!hasFilePath) return './';
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const isRoot = lastSlash === -1;
  if (isRoot) return './';
  return normalized.slice(0, lastSlash + 1);
};

export const groupViolationsByDirectory = (violations = []) => {
  const dirMap = new Map();

  for (const v of violations) {
    const dir = resolveDirectory(v.filePath);
    let group = dirMap.get(dir);
    if (!group) {
      group = {
        directory: dir,
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        violations: [],
        rulesMap: new Map()
      };
      dirMap.set(dir, group);
    }

    group.total += 1;
    group.violations.push(v);
    if (v.severity === 'CRITICAL') group.critical += 1;
    else if (v.severity === 'HIGH') group.high += 1;
    else if (v.severity === 'MEDIUM') group.medium += 1;
    else group.low += 1;

    const count = group.rulesMap.get(v.rule) || 0;
    group.rulesMap.set(v.rule, count + 1);
  }

  const createDirectorySummary = (g) => {
    const topRules = Array.from(g.rulesMap.entries())
      .map(([rule, count]) => ({ rule, count }))
      .sort((a, b) => b.count - a.count);

    return {
      directory: g.directory,
      total: g.total,
      critical: g.critical,
      high: g.high,
      medium: g.medium,
      low: g.low,
      violations: g.violations,
      topRules
    };
  };

  const result = Array.from(dirMap.values()).map(createDirectorySummary);

  const calculateDirectoryWeight = (g) => g.critical * 1000 + g.high * 100 + g.medium * 10 + g.low;

  const compareDirectoryRisk = (a, b) => {
    const weightDiff = calculateDirectoryWeight(b) - calculateDirectoryWeight(a);
    const hasWeightDiff = weightDiff !== 0;
    if (hasWeightDiff) return weightDiff;
    return b.total - a.total;
  };

  result.sort(compareDirectoryRisk);
  return result;
};

export const groupViolationsByRule = (violations = []) => {
  const ruleMap = new Map();

  for (const v of violations) {
    let group = ruleMap.get(v.rule);
    if (!group) {
      group = {
        rule: v.rule,
        severity: v.severity,
        pillar: v.pillar,
        directive: v.directive,
        hazard: v.hazard,
        isAiSlop: Boolean(v.isAiSlop),
        total: 0,
        violations: [],
        dirsMap: new Map()
      };
      ruleMap.set(v.rule, group);
    }

    group.total += 1;
    group.violations.push(v);

    const dir = resolveDirectory(v.filePath);
    let dirViolations = group.dirsMap.get(dir);
    if (!dirViolations) {
      dirViolations = [];
      group.dirsMap.set(dir, dirViolations);
    }
    dirViolations.push(v);
  }

  const createRuleSummary = (g) => {
    const directories = Array.from(g.dirsMap.entries()).map(([directory, list]) => ({
      directory,
      count: list.length,
      violations: list
    }));

    return {
      rule: g.rule,
      severity: g.severity,
      pillar: g.pillar,
      directive: g.directive,
      hazard: g.hazard,
      isAiSlop: g.isAiSlop,
      total: g.total,
      violations: g.violations,
      directories
    };
  };

  const result = Array.from(ruleMap.values()).map(createRuleSummary);

  const SEVERITY_RANKS = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  const compareRuleSeverity = (a, b) => {
    const rankDiff = (SEVERITY_RANKS[b.severity] || 0) - (SEVERITY_RANKS[a.severity] || 0);
    const hasRankDiff = rankDiff !== 0;
    if (hasRankDiff) return rankDiff;
    return b.total - a.total;
  };

  result.sort(compareRuleSeverity);
  return result;
};

const resolveSeverityColor = (severity) => {
  if (severity === 'CRITICAL') return RED;
  if (severity === 'HIGH') return ORANGE;
  if (severity === 'MEDIUM') return YELLOW;
  return DIM;
};

export const buildPathTree = (violations = []) => {
  const root = { dirs: new Map(), files: new Map() };

  for (const v of violations) {
    const rawPath = v.filePath || '';
    const normalized = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
    const segments = normalized.split('/');
    const fileName = segments.pop();

    let current = root;
    for (const seg of segments) {
      const segName = seg.endsWith('/') ? seg : `${seg}/`;
      if (!current.dirs.has(segName)) {
        current.dirs.set(segName, { dirs: new Map(), files: new Map() });
      }
      current = current.dirs.get(segName);
    }

    if (!current.files.has(fileName)) {
      current.files.set(fileName, []);
    }
    const loc = v.column ? `${v.line}:${v.column}` : `${v.line}`;
    current.files.get(fileName).push(loc);
  }

  return root;
};

export const formatCompactLocations = (violations, maxShown = 4) => {
  const formatLocationItem = (v) => {
    const base = path.basename(v.filePath);
    return `${YELLOW}${base}:${v.line}:${v.column}${RESET}`;
  };

  const items = violations.slice(0, maxShown).map(formatLocationItem);
  const remaining = violations.length - maxShown;
  const hasRemaining = remaining > 0;
  if (hasRemaining) {
    items.push(`${DIM}(+${remaining} more)${RESET}`);
  }
  return items.join(', ');
};

export const renderGroupedViolationsTerminal = (violations) => {
  const hasNoViolations = violations.length === 0;
  if (hasNoViolations) return '';

  const ruleGroups = groupViolationsByRule(violations);
  const lines = [];

  ruleGroups.forEach((rg, idx) => {
    const sevColor = resolveSeverityColor(rg.severity);
    const countLabel = rg.total === 1 ? '1 item' : `${rg.total} items`;
    const isSingleOccurrence = rg.total === 1;

    if (isSingleOccurrence) {
      const v = rg.violations[0];
      const colStr = v.column ? `:${v.column}` : '';
      lines.push(`   ${sevColor}[#${idx + 1} ${rg.severity}]${RESET} [${rg.rule}] ${YELLOW}${v.filePath}:${v.line}${colStr}${RESET}`);
      lines.push(`      Hazard:    ${rg.hazard}`);
      lines.push(`      Directive: ${CYAN}${rg.directive}${RESET}\n`);
      return;
    }

    const dirCount = rg.directories.length;
    const dirLabel = dirCount === 1 ? '1 directory' : `${dirCount} directories`;
    lines.push(`   ${sevColor}[#${idx + 1} ${rg.severity}]${RESET} [${rg.rule}] ${BOLD}${countLabel}${RESET} ${DIM}across ${dirLabel}${RESET}`);
    lines.push(`      Hazard:    ${rg.hazard}`);
    lines.push(`      Directive: ${CYAN}${rg.directive}${RESET}`);
    lines.push(`      Locations:`);

    const tree = buildPathTree(rg.violations);
    const renderTerminalTree = (node, depth = 0) => {
      const indent = '        ' + '  '.repeat(depth);

      const sortedDirs = Array.from(node.dirs.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      for (const [dirName, childNode] of sortedDirs) {
        lines.push(`${indent}📁 ${BOLD}${dirName}${RESET}`);
        renderTerminalTree(childNode, depth + 1);
      }

      const sortedFiles = Array.from(node.files.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      for (const [fileName, locs] of sortedFiles) {
        const uniqueLocs = Array.from(new Set(locs)).join(', ');
        lines.push(`${indent}- ${YELLOW}${fileName}:${uniqueLocs}${RESET}`);
      }
    };

    renderTerminalTree(tree, 0);
    lines.push('');
  });

  return lines.join('\n');
};

export const formatDirectoryDistributionSection = (report, themeColor = null) => {
  const { violations = [] } = report;
  const sectionColor = themeColor || resolveTopSectionColor(report);
  const dirGroups = groupViolationsByDirectory(violations);
  const lines = [];

  lines.push('');
  lines.push(`${sectionColor}======================================================================${RESET}`);
  lines.push(`${BOLD}${sectionColor}   HAZARD DISTRIBUTION BY DIRECTORY${RESET}`);
  lines.push(`${sectionColor}======================================================================${RESET}`);

  const hasNoViolations = dirGroups.length === 0;
  if (hasNoViolations) {
    lines.push(`   ${GREEN}✔ Zero violations detected across all project directories.${RESET}`);
  } else {
    lines.push(`   ${DIM}Directory                              Total  Crit  High   Med   Low${RESET}`);
    lines.push(`   ${DIM}------------------------------------------------------------------${RESET}`);
    for (const g of dirGroups) {
      const isLongDir = g.directory.length > 36;
      const padDir = isLongDir ? `${g.directory.slice(0, 33)}...` : g.directory.padEnd(36, ' ');
      const totalStr = `${BOLD}${g.total}${RESET}`.padStart(6, ' ');
      const critStr = (g.critical > 0 ? `${RED}${g.critical}${RESET}` : `${DIM}0${RESET}`).padStart(5, ' ');
      const highStr = (g.high > 0 ? `${ORANGE}${g.high}${RESET}` : `${DIM}0${RESET}`).padStart(5, ' ');
      const medStr = (g.medium > 0 ? `${YELLOW}${g.medium}${RESET}` : `${DIM}0${RESET}`).padStart(5, ' ');
      const lowStr = (g.low > 0 ? `${DIM}${g.low}${RESET}` : `${DIM}0${RESET}`).padStart(5, ' ');
      lines.push(`   ${padDir} ${totalStr} ${critStr} ${highStr} ${medStr} ${lowStr}`);
    }
  }
  lines.push(`${sectionColor}======================================================================${RESET}\n`);

  return lines.join('\n');
};
