import fs from 'node:fs';
import path from 'node:path';
import {
  hasGum,
  gumChoose,
  gumInput,
  promptQuestion,
  renderBanner
} from './terminal.js';
import { copyToClipboard } from './audit/social-git.js';
import { getAuditHistory, getAuditBaseline } from './audit/history.js';
import { getStoredDiscussion } from './audit/discussion-store.js';

export const resolveLatestAuditInfo = (cwd = process.cwd()) => {
  const stored = getStoredDiscussion(cwd);
  const discussionUrl = stored?.url || null;

  const history = getAuditHistory(cwd);
  if (history.length > 0) {
    const latest = history[history.length - 1];
    return {
      grade: latest.health?.grade || 'A+',
      score: latest.health?.score || 100,
      label: latest.health?.label || 'Optimal',
      discussionUrl
    };
  }
  const baseline = getAuditBaseline(cwd);
  if (baseline) {
    return {
      grade: baseline.health?.grade || 'A+',
      score: baseline.health?.score || 100,
      label: baseline.health?.label || 'Optimal',
      discussionUrl
    };
  }
  return { grade: 'A+', score: 100, label: 'Optimal', discussionUrl };
};

export const generateMinimalTextSnippet = (label, grade, discussionUrl = null) => {
  const gradeElement = discussionUrl
    ? `<a href="${discussionUrl}" target="_blank" rel="noopener noreferrer" style="font-weight:bold;color:#a3e635;text-decoration:none;" title="View verified audit report on GitHub Discussions"> [${grade}]</a>`
    : `<span style="font-weight:bold;color:#a3e635;"> [${grade}]</span>`;

  return `<p style="font-family:monospace;font-size:11px;color:#94a3b8;margin:0.25rem 0;">
  ${label}
  <a href="https://chemicalx.xophz.com" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;text-decoration:none;font-weight:500;">Chemical X</a>
  ${gradeElement}
</p>`;
};

export const generateHtmlBadgeSnippet = (label, grade, discussionUrl = null) => {
  const targetHref = discussionUrl || 'https://chemicalx.xophz.com';
  const targetTitle = discussionUrl ? 'Verified Chemical X Audit Report on GitHub Discussions' : 'Verified by Chemical X Protocol';

  return `<a href="${targetHref}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:8px;padding:4px 12px;border-radius:9999px;font-family:monospace;font-size:11px;text-decoration:none;border:1px solid rgba(56,189,248,0.35);background:rgba(9,13,22,0.85);backdrop-filter:blur(8px);color:#e2e8f0;transition:all 0.2s ease;" title="${targetTitle}">
  <span style="width:8px;height:8px;border-radius:50%;background:#a3e635;box-shadow:0 0 6px rgba(163,230,53,0.6);"></span>
  <span>${label}</span>
  <span style="padding:2px 7px;border-radius:9999px;font-weight:bold;font-size:10px;background:rgba(163,230,53,0.15);color:#a3e635;border:1px solid rgba(163,230,53,0.3);">${grade}</span>
</a>`;
};

export const generateMarkdownBadgeSnippet = (label, grade, discussionUrl = null) => {
  const targetHref = discussionUrl || 'https://chemicalx.xophz.com';
  const encodedLabel = encodeURIComponent(label.replace(/ /g, '_'));
  const encodedGrade = encodeURIComponent(`[${grade}]`);
  return `[![Chemical X Verified](https://img.shields.io/badge/${encodedLabel}-${encodedGrade}-06b6d4?style=for-the-badge&logo=shield)](${targetHref})`;
};

export const generateVueBadgeSnippet = (label, grade, discussionUrl = null) => {
  const defaultReportUrl = discussionUrl ? `'${discussionUrl}'` : 'undefined';

  return `<script setup lang="ts">
interface Props {
  label?: string;
  grade?: string;
  href?: string;
  reportUrl?: string;
}

withDefaults(defineProps<Props>(), {
  label: '${label}',
  grade: '${grade}',
  href: 'https://chemicalx.xophz.com',
  reportUrl: ${defaultReportUrl}
});
</script>

<template>
  <p class="chemx-footer-line font-mono text-[0.65rem] text-zinc-500 dark:text-zinc-400">
    {{ label }}
    <a
      :href="href"
      target="_blank"
      rel="noopener noreferrer"
      class="text-sky-600 dark:text-sky-400 hover:underline font-medium"
    >Chemical X</a>
    <a
      v-if="reportUrl && grade"
      :href="reportUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="font-bold text-lime-600 dark:text-lime-400 hover:underline"
      title="View verified Chemical X audit report"
    >&nbsp;[{{ grade }}]</a>
    <span v-else-if="grade" class="font-bold text-lime-600 dark:text-lime-400">&nbsp;[{{ grade }}]</span>
  </p>
</template>
`;
};

export const generateReactBadgeSnippet = (label, grade, discussionUrl = null) => {
  const defaultReportUrl = discussionUrl ? `'${discussionUrl}'` : 'undefined';

  return `import React from 'react';

export interface ChemicalXBadgeProps {
  label?: string;
  grade?: string;
  href?: string;
  reportUrl?: string;
}

export const ChemicalXBadge: React.FC<ChemicalXBadgeProps> = ({
  label = '${label}',
  grade = '${grade}',
  href = 'https://chemicalx.xophz.com',
  reportUrl = ${defaultReportUrl}
}) => (
  <p className="chemx-footer-line" style={{ fontFamily: 'monospace', fontSize: 11, color: '#94a3b8' }}>
    {label}{' '}
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#38bdf8', textDecoration: 'none' }}>
      Chemical X
    </a>
    {reportUrl && grade ? (
      <a
        href={reportUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontWeight: 'bold', color: '#a3e635', textDecoration: 'none' }}
        title="View verified Chemical X audit report on GitHub Discussions"
      >
        {' '}[{grade}]
      </a>
    ) : (
      grade && <span style={{ fontWeight: 'bold', color: '#a3e635' }}> [{grade}]</span>
    )}
  </p>
);

export default ChemicalXBadge;
`;
};

export const generateSvgBadgeSnippet = (label, grade) => {
  const width = Math.max(280, label.length * 8 + 60);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28" viewBox="0 0 ${width} 28" fill="none">
  <defs>
    <linearGradient id="chemx-comic" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#f43f85"/>
      <stop offset="50%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#a3e635"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="28" rx="14" fill="#090d16" stroke="url(#chemx-comic)" stroke-width="1.2"/>
  <circle cx="16" cy="14" r="4" fill="#a3e635"/>
  <text x="28" y="17" fill="#cbd5e1" font-family="monospace" font-size="11" font-weight="500">${label}</text>
  <rect x="${width - 44}" y="6" width="34" height="16" rx="8" fill="#a3e635" fill-opacity="0.18" stroke="#a3e635" stroke-opacity="0.4"/>
  <text x="${width - 27}" y="17" text-anchor="middle" fill="#a3e635" font-family="monospace" font-size="10" font-weight="700">${grade}</text>
</svg>`;
};

export const runBadgeCommand = async (rawArgs = []) => {
  renderBanner('Chemical X: Verified Footer Badge Generator');

  const detected = resolveLatestAuditInfo();
  const gradeFlag = rawArgs.find((a) => a.startsWith('--grade='));
  const labelFlag = rawArgs.find((a) => a.startsWith('--label='));
  const reportFlag = rawArgs.find((a) => a.startsWith('--report-url=') || a.startsWith('--discussion='));
  const formatFlag = rawArgs.find((a) => a.startsWith('--format='));
  const isCopy = rawArgs.includes('--copy');

  const grade = gradeFlag ? gradeFlag.split('=')[1].toUpperCase() : detected.grade;
  const label = labelFlag ? labelFlag.split('=')[1] : 'AI Slop cleaned with Chemical X';
  const discussionUrl = reportFlag ? reportFlag.split('=')[1] : detected.discussionUrl;

  process.stdout.write(`Active Codebase Grade: \x1b[32;1m[${grade}]\x1b[0m (Score: ${detected.score}/100)\n`);
  process.stdout.write(`Badge Copy: \x1b[36m"${label}"\x1b[0m\n`);
  if (discussionUrl) {
    process.stdout.write(`Discussion Report: \x1b[35m${discussionUrl}\x1b[0m\n\n`);
  } else {
    process.stdout.write(`Discussion Report: \x1b[33mNone (Run 'npx chemx audit --share' to publish)\x1b[0m\n\n`);
  }

  let chosenFormat = formatFlag ? formatFlag.split('=')[1].toLowerCase() : null;

  if (!chosenFormat) {
    if (hasGum()) {
      const choice = gumChoose([
        '1. 📝 Minimal Inline Footer Text (HTML <p> & <a> - Matches any footer)',
        '2. 🌐 Glassmorphic Pill Badge (HTML / Inline CSS)',
        '3. 💚 Vue 3.4+ Component (<script setup lang="ts">)',
        '4. ⚛️  React 19 Component (TSX)',
        '5. 📋 Markdown / Shields.io (README & Docs)',
        '6. 🖼️  SVG Standalone Asset (chemx-badge.svg)',
        '7. 📦 Print All Snippets'
      ], 'Select Badge Format');

      if (choice?.includes('1.')) chosenFormat = 'text';
      else if (choice?.includes('2.')) chosenFormat = 'html';
      else if (choice?.includes('3.')) chosenFormat = 'vue';
      else if (choice?.includes('4.')) chosenFormat = 'react';
      else if (choice?.includes('5.')) chosenFormat = 'markdown';
      else if (choice?.includes('6.')) chosenFormat = 'svg';
      else chosenFormat = 'all';
    } else {
      process.stdout.write('Select Badge Format:\n');
      process.stdout.write('  [1] Minimal Inline Footer Text (HTML <p> & <a>)\n');
      process.stdout.write('  [2] Glassmorphic Pill Badge (HTML / CSS)\n');
      process.stdout.write('  [3] Vue 3.4+ Component\n');
      process.stdout.write('  [4] React 19 Component\n');
      process.stdout.write('  [5] Markdown / Shields.io\n');
      process.stdout.write('  [6] SVG Standalone Asset\n');
      process.stdout.write('  [7] Print All Snippets\n');
      const input = await promptQuestion('Choice [1]: ');
      if (input === '2') chosenFormat = 'html';
      else if (input === '3') chosenFormat = 'vue';
      else if (input === '4') chosenFormat = 'react';
      else if (input === '5') chosenFormat = 'markdown';
      else if (input === '6') chosenFormat = 'svg';
      else if (input === '7') chosenFormat = 'all';
      else chosenFormat = 'text';
    }
  }

  const snippets = {
    text: generateMinimalTextSnippet(label, grade, discussionUrl),
    html: generateHtmlBadgeSnippet(label, grade, discussionUrl),
    vue: generateVueBadgeSnippet(label, grade, discussionUrl),
    react: generateReactBadgeSnippet(label, grade, discussionUrl),
    markdown: generateMarkdownBadgeSnippet(label, grade, discussionUrl),
    svg: generateSvgBadgeSnippet(label, grade)
  };

  if (chosenFormat === 'all') {
    for (const [key, content] of Object.entries(snippets)) {
      process.stdout.write(`\x1b[1m\x1b[36m--- ${key.toUpperCase()} ---\x1b[0m\n${content}\n\n`);
    }
    return;
  }

  const outputSnippet = snippets[chosenFormat] || snippets.text;
  process.stdout.write(`\n\x1b[1m\x1b[32m✔ Chemical X Footer Badge (${chosenFormat.toUpperCase()}):\x1b[0m\n\n`);
  process.stdout.write(outputSnippet + '\n\n');

  if (chosenFormat === 'svg') {
    const saveSvg = path.resolve(process.cwd(), 'chemx-badge.svg');
    fs.writeFileSync(saveSvg, outputSnippet, 'utf-8');
    process.stdout.write(`\x1b[32m✔ Saved SVG badge asset to:\x1b[0m ${saveSvg}\n\n`);
  }

  const shouldCopy = isCopy || (hasGum() ? true : true);
  if (shouldCopy) {
    const success = copyToClipboard(outputSnippet);
    if (success) {
      process.stdout.write('\x1b[32m✔ Badge snippet copied to clipboard! Paste directly into your footer.\x1b[0m\n\n');
    }
  }
};
