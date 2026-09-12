import path from 'node:path';
import {
  groupViolationsByDirectory,
  groupViolationsByRule
} from './reporter-grouping.js';

export const formatDirectoryRollupMarkdown = (violations = []) => {
  const dirGroups = groupViolationsByDirectory(violations);
  const lines = [];

  lines.push('### Directory Hazard Rollup');
  lines.push('');

  const hasNoViolations = dirGroups.length === 0;
  if (hasNoViolations) {
    lines.push('🟢 Zero violations detected across all project directories.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('| Directory | Total Hazards | Critical | High | Med | Low | Primary Hazards |');
  lines.push('| :--- | :---: | :---: | :---: | :---: | :---: | :--- |');

  for (const g of dirGroups) {
    const topHazards = g.topRules
      .slice(0, 2)
      .map((r) => `\`${r.rule}\` (${r.count})`)
      .join(', ');
    const displayHazards = topHazards || 'None';
    lines.push(`| \`${g.directory}\` | **${g.total}** | ${g.critical} | ${g.high} | ${g.medium} | ${g.low} | ${displayHazards} |`);
  }
  lines.push('');

  return lines.join('\n');
};

export const renderGroupedViolationsMarkdown = (violations = [], options = {}) => {
  const { showSeverity = false } = options;
  const hasNoViolations = violations.length === 0;
  if (hasNoViolations) return '';

  const ruleGroups = groupViolationsByRule(violations);
  const lines = [];

  const headers = showSeverity
    ? '| Rule | Severity | Count | Directive | Affected Locations by Directory |'
    : '| Rule | Count | Directive | Affected Locations by Directory |';
  const divider = showSeverity
    ? '| :--- | :---: | :---: | :--- | :--- |'
    : '| :--- | :---: | :--- | :--- |';

  lines.push(headers);
  lines.push(divider);

  for (const rg of ruleGroups) {
    const dirSummaries = rg.directories.map((d) => {
      const formatLocationItem = (v) => {
        const base = path.basename(v.filePath);
        return `\`${base}:${v.line}\``;
      };

      const locList = d.violations.slice(0, 3).map(formatLocationItem);
      const remaining = d.violations.length - 3;
      const hasRemaining = remaining > 0;
      if (hasRemaining) {
        locList.push(`*(+${remaining} more)*`);
      }
      return `📁 **\`${d.directory}\`** (${d.count}): ${locList.join(', ')}`;
    });

    const locationCell = dirSummaries.join('<br>');
    const sanitizedDirective = rg.directive.replace(/\|/g, '\\|');

    if (showSeverity) {
      lines.push(`| \`${rg.rule}\` | ${rg.severity} | **${rg.total}** | ${sanitizedDirective} | ${locationCell} |`);
    } else {
      lines.push(`| \`${rg.rule}\` | **${rg.total}** | ${sanitizedDirective} | ${locationCell} |`);
    }
  }
  lines.push('');

  return lines.join('\n');
};
