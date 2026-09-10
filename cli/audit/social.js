import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { buildMasterPrompt } from './prompts.js';
import { PILLAR_EMOJIS, NUMBER_EMOJIS } from './reporter-utils.js';

export const parseGitRemoteUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  const clean = url.trim().replace(/^git\+/, '').replace(/\.git$/, '');

  // Match HTTPS / SSH: https://github.com/owner/repo or ssh://git@github.com/owner/repo
  const httpMatch = clean.match(/^(?:https?|ssh|git):\/\/[^/]+\/([^/]+)\/([^/]+)$/);
  if (httpMatch) {
    const owner = httpMatch[1];
    const repo = httpMatch[2];
    return {
      owner,
      repo,
      nameWithOwner: `${owner}/${repo}`,
      url: `https://github.com/${owner}/${repo}`
    };
  }

  // Match SCP-like SSH: git@github.com:owner/repo
  const scpMatch = clean.match(/^[\w\-]+@[^:]+:([^/]+)\/([^/]+)$/);
  if (scpMatch) {
    const owner = scpMatch[1];
    const repo = scpMatch[2];
    return {
      owner,
      repo,
      nameWithOwner: `${owner}/${repo}`,
      url: `https://github.com/${owner}/${repo}`
    };
  }

  return null;
};

export const detectGitRepoInfo = (cwd = process.cwd()) => {
  // 1. Try git remote get-url origin
  try {
    const res = spawnSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (res.status === 0 && res.stdout) {
      const parsed = parseGitRemoteUrl(res.stdout);
      if (parsed) return parsed;
    }
  } catch {}

  // 2. Try git config --get remote.origin.url
  try {
    const res = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (res.status === 0 && res.stdout) {
      const parsed = parseGitRemoteUrl(res.stdout);
      if (parsed) return parsed;
    }
  } catch {}

  // 3. Try any available remote if origin is not configured
  try {
    const remotesRes = spawnSync('git', ['remote'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (remotesRes.status === 0 && remotesRes.stdout) {
      const firstRemote = (remotesRes.stdout.trim().split(/\s+/)[0] || '').trim();
      if (firstRemote) {
        const urlRes = spawnSync('git', ['remote', 'get-url', firstRemote], {
          cwd,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore']
        });
        if (urlRes.status === 0 && urlRes.stdout) {
          const parsed = parseGitRemoteUrl(urlRes.stdout);
          if (parsed) return parsed;
        }
      }
    }
  } catch {}

  // 4. Try package.json repository or name field
  try {
    const pkgPath = path.resolve(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const repoUrl = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
      if (repoUrl) {
        const parsed = parseGitRemoteUrl(repoUrl);
        if (parsed) return parsed;
      }
      if (pkg.name) {
        if (pkg.name.startsWith('@') && pkg.name.includes('/')) {
          const [scope, pkgRepo] = pkg.name.slice(1).split('/');
          return {
            owner: scope,
            repo: pkgRepo,
            nameWithOwner: `${scope}/${pkgRepo}`,
            url: `https://github.com/${scope}/${pkgRepo}`
          };
        }
        return {
          owner: '',
          repo: pkg.name,
          nameWithOwner: pkg.name,
          url: ''
        };
      }
    }
  } catch {}

  // 5. Try git rev-parse toplevel folder name
  try {
    const topRes = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (topRes.status === 0 && topRes.stdout) {
      const topDir = topRes.stdout.trim();
      const repoName = path.basename(topDir);
      if (repoName) {
        return {
          owner: '',
          repo: repoName,
          nameWithOwner: repoName,
          url: ''
        };
      }
    }
  } catch {}

  const fallback = path.basename(cwd) || 'Codebase';
  return {
    owner: '',
    repo: fallback,
    nameWithOwner: fallback,
    url: ''
  };
};

export const detectGitHubUser = (preferredUser) => {
  if (preferredUser && typeof preferredUser === 'string') {
    const trimmed = preferredUser.trim();
    if (trimmed && trimmed !== 'Architect') return trimmed;
  }

  // 1. Try gh api if authenticated with valid token
  try {
    const res = spawnSync('gh', ['api', 'user', '-q', '.login'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (res.status === 0) {
      const user = (res.stdout || '').trim();
      if (user && /^[a-zA-Z0-9_\-]+$/.test(user)) return user;
    }
  } catch {}

  // 2. Try gh auth status account name (persists in config even if token is temporarily expired)
  try {
    const statusRes = spawnSync('gh', ['auth', 'status'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    const output = `${statusRes.stdout || ''} ${statusRes.stderr || ''}`.trim();
    const match = output.match(/account\s+([a-zA-Z0-9_\-]+)/i) || output.match(/Logged in to [^\s]+ account ([a-zA-Z0-9_\-]+)/i);
    if (match && match[1]) {
      const user = match[1].trim();
      if (user && user !== 'default') return user;
    }
  } catch {}

  // 3. Try git config github.user
  try {
    const ghUser = spawnSync('git', ['config', 'github.user'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const u = (ghUser.stdout || '').trim();
    if (u && /^[a-zA-Z0-9_\-]+$/.test(u)) return u;
  } catch {}

  // 4. Try git config user.name
  try {
    const gitRes = spawnSync('git', ['config', 'user.name'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const name = (gitRes.stdout || '').trim();
    if (name && /^[a-zA-Z0-9_\-]+$/.test(name)) return name;
  } catch {}

  return 'Architect';
};

export const copyToClipboard = (text) => {
  try {
    if (process.platform === 'darwin') {
      const res = spawnSync('pbcopy', [], { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      return res.status === 0;
    }
    if (process.platform === 'win32') {
      const res = spawnSync('clip', [], { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      return res.status === 0;
    }
    // Linux: try wl-copy then xclip
    const wl = spawnSync('which', ['wl-copy'], { stdio: 'ignore' });
    if (wl.status === 0) {
      const res = spawnSync('wl-copy', [], { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      if (res.status === 0) return true;
    }
    const xc = spawnSync('which', ['xclip'], { stdio: 'ignore' });
    if (xc.status === 0) {
      const res = spawnSync('xclip', ['-selection', 'clipboard'], { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      if (res.status === 0) return true;
    }
  } catch {}
  return false;
};

export const DISCUSSION_CATEGORY = 'npx chemx audit';
export const DISCUSSION_CATEGORY_SLUG = 'npx-chemx-audit';
export const ORG_DISCUSSIONS_URL = 'https://github.com/orgs/Chemical-X-Protocol/discussions';
export const DEFAULT_DISCUSSION_REPO = 'Chemical-X-Protocol/.github';

const resolveBadgeColor = (score) => {
  if (score >= 90) return '06b6d4';
  if (score >= 70) return 'f59e0b';
  return 'ef4444';
};

const resolveHotspotTierText = (lineCount) => {
  if (lineCount >= 2000) return '🔴 **CRITICAL (>= 2,000 LOC)**';
  if (lineCount >= 1000) return '🟠 **SEVERE (>= 1,000 LOC)**';
  if (lineCount > 500) return '🟡 **WARNING (> 500 LOC)**';
  return '🟢 Compliant';
};

export const generateDiscussionContent = (report, username, projectName = 'Codebase', repoUrl = '') => {
  const { health, metrics, pillars, hotspots, contextAnalysis, violations } = report;
  const isHighScoring = health.score >= 80;
  const badgeColor = resolveBadgeColor(health.score);
  const encodedGrade = encodeURIComponent(`${health.score}/100 (${health.grade})`);

  const category = DISCUSSION_CATEGORY;
  const categorySlug = DISCUSSION_CATEGORY_SLUG;
  const prefix = isHighScoring ? '[Showcase]' : '[Teardown]';
  const title = `${prefix} ${projectName} : MHI ${health.score}/100 [Grade: ${health.grade}]`;

  const lines = [];
  lines.push(`# ${isHighScoring ? 'Crystalline' : 'Architecture'} Audit Report: ${projectName}`);
  lines.push('');
  lines.push(`[![Chemical X MHI](https://img.shields.io/badge/Chemical%20X%20MHI-${encodedGrade}-${badgeColor}?style=for-the-badge)](https://chemicalx.xophz.com)`);
  lines.push('');
  lines.push(`* **Audited by**: @${username}`);
  const resolvedRepoUrl = repoUrl || (/^[\w\-.]+\/[\w\-.]+$/.test(projectName) ? `https://github.com/${projectName}` : '');
  if (resolvedRepoUrl) {
    lines.push(`* **Repository**: ${resolvedRepoUrl}`);
  }
  lines.push(`* **Molecular Health Index**: **${health.score} / 100** (Grade: **${health.grade}** - ${health.label})`);
  lines.push(`* **Source Files Analyzed**: ${metrics.scannedFiles} files (${metrics.totalLoc} total LOC)`);
  lines.push(`* **Token Reduction Potential**: **${contextAnalysis.potentialSavingsPct}%** (Estimated ${contextAnalysis.estimatedTokens.toLocaleString()} tokens)`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 1. 7-Pillar Architectural Matrix');
  lines.push('');
  lines.push('| Pillar | Status | Hazards |');
  lines.push('| :--- | :---: | :---: |');

  const resolveStatusDisplay = (status) => {
    if (status === 'PASSED') return '🟢 **PASSED**';
    if (status === 'WARN') return '🟡 **WARN**';
    return '🔴 **FAILED**';
  };

  const resolveHazardsDisplay = (count, status) => {
    if (count === 0) return '🟢 0';
    if (status === 'FAILED') return `🔴 **${count}**`;
    return `🟡 **${count}**`;
  };

  for (const [pillarName, data] of Object.entries(pillars)) {
    const icon = PILLAR_EMOJIS[pillarName] || '🏛️';
    const statusText = resolveStatusDisplay(data.status);
    const hazardsText = resolveHazardsDisplay(data.violations, data.status);
    lines.push(`| ${icon} ${pillarName} | ${statusText} | ${hazardsText} |`);
  }
  lines.push('');

  const { critical, high, medium, low } = groupViolationsBySeverity(violations);
  const extremeMonoliths = hotspots.filter((h) => h.lineCount >= 2000).length;
  const severeMonoliths = hotspots.filter((h) => h.lineCount >= 1000 && h.lineCount < 2000).length;
  const warningMonoliths = hotspots.filter((h) => h.lineCount >= 500 && h.lineCount < 1000).length;
  const totalMonoliths = extremeMonoliths + severeMonoliths + warningMonoliths;

  lines.push('---');
  lines.push('');
  lines.push('## 2. Monolith & Architectural Hazard Summary');
  lines.push('');
  lines.push(`* **Monolith Files (> 500 LOC)**: **${totalMonoliths} files**`);
  if (totalMonoliths > 0) {
    lines.push(`  * Warning Tier (500 - 999 LOC): ${warningMonoliths} files`);
    lines.push(`  * Severe Tier (1,000 - 1,999 LOC): ${severeMonoliths} files`);
    lines.push(`  * Extreme Monoliths (2,000+ LOC): ${extremeMonoliths} files`);
  }
  lines.push(`* **Hazard Breakdown**: Critical: **${critical.length}** | High/Med: **${high.length + medium.length}** | Low: **${low.length}**`);
  lines.push('');

  lines.push('---');
  lines.push('');
  if (isHighScoring) {
    lines.push('### Community Takeaway');
    lines.push('This project follows Chemical X Molecular Architecture principles with isolated capsules and self-cleaning hooks.');
  } else {
    lines.push('### Seeking Refactoring Feedback');
    lines.push('Looking for recommendations on breaking down flagged monolithic debts into crystalline molecule capsules (< 100 LOC). Any advice is welcome!');
  }
  lines.push('');
  lines.push('*Audited using [Chemical X Protocol Starter Kit](https://github.com/Chemical-X-Protocol/awesome-secret-sauce).*');

  return {
    title,
    category,
    categorySlug,
    body: lines.join('\n')
  };
};

export const generateTransformationDiscussionContent = (
  beforeSnapshot,
  afterSnapshot,
  username,
  projectName = 'Codebase',
  repoUrl = ''
) => {
  const scoreBefore = beforeSnapshot.health.score;
  const scoreAfter = afterSnapshot.health.score;
  const scoreDelta = scoreAfter - scoreBefore;

  const critDelta = afterSnapshot.violations.critical - beforeSnapshot.violations.critical;
  const totalDelta = afterSnapshot.violations.total - beforeSnapshot.violations.total;
  const monoDelta = afterSnapshot.monoliths.total - beforeSnapshot.monoliths.total;
  const tokensDelta = afterSnapshot.tokens.estimatedExcessTokens - beforeSnapshot.tokens.estimatedExcessTokens;

  const category = DISCUSSION_CATEGORY;
  const categorySlug = DISCUSSION_CATEGORY_SLUG;
  const title = `[Transformation] ${projectName} : ${beforeSnapshot.health.grade} (${scoreBefore}) -> ${afterSnapshot.health.grade} (${scoreAfter})`;

  const formatDelta = (val, invertGood = false) => {
    if (val === 0) return '0 (No change)';
    const isGood = invertGood ? val < 0 : val > 0;
    const sign = val > 0 ? `+${val}` : `${val}`;
    return isGood ? `🟢 **${sign}**` : `🔴 **${sign}**`;
  };

  const lines = [];
  lines.push(`# 🚀 Architectural Transformation: ${projectName}`);
  lines.push('');
  lines.push(`[![Chemical X Transformation](https://img.shields.io/badge/Chemical%20X-Transformation%20Showcase-62c9ff?style=for-the-badge)](https://chemicalx.xophz.com)`);
  lines.push('');
  lines.push(`* **Audited by**: @${username}`);
  const resolvedRepoUrl = repoUrl || (/^[\w\-.]+\/[\w\-.]+$/.test(projectName) ? `https://github.com/${projectName}` : '');
  if (resolvedRepoUrl) {
    lines.push(`* **Repository**: ${resolvedRepoUrl}`);
  }
  lines.push(`* **Transformation Summary**: Upgraded codebase from **Grade ${beforeSnapshot.health.grade} (${scoreBefore}/100)** to **Grade ${afterSnapshot.health.grade} (${scoreAfter}/100)**.`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 1. Before vs. After Metric Comparison');
  lines.push('');
  lines.push('| Metric | Before (Baseline) | After (Refactored) | Delta |');
  lines.push('| :--- | :---: | :---: | :---: |');
  lines.push(`| **Molecular Health (MHI)** | ${scoreBefore} / 100 (${beforeSnapshot.health.grade}) | ${scoreAfter} / 100 (${afterSnapshot.health.grade}) | ${formatDelta(scoreDelta)} |`);
  lines.push(`| **Critical Hazards** | ${beforeSnapshot.violations.critical} | ${afterSnapshot.violations.critical} | ${formatDelta(critDelta, true)} |`);
  lines.push(`| **Total Violations** | ${beforeSnapshot.violations.total} | ${afterSnapshot.violations.total} | ${formatDelta(totalDelta, true)} |`);
  lines.push(`| **Monolith Files (>500 LOC)** | ${beforeSnapshot.monoliths.total} | ${afterSnapshot.monoliths.total} | ${formatDelta(monoDelta, true)} |`);
  lines.push(`| **Excess Token Burn** | ${beforeSnapshot.tokens.estimatedExcessTokens.toLocaleString()} tok | ${afterSnapshot.tokens.estimatedExcessTokens.toLocaleString()} tok | ${formatDelta(tokensDelta, true)} |`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 2. 7-Pillar Progression');
  lines.push('');
  lines.push('| Pillar | Before Status | After Status | Progression |');
  lines.push('| :--- | :---: | :---: | :---: |');

  const allPillars = new Set([
    ...Object.keys(beforeSnapshot.pillars || {}),
    ...Object.keys(afterSnapshot.pillars || {})
  ]);

  for (const pillar of allPillars) {
    const b = beforeSnapshot.pillars?.[pillar] || { status: 'UNKNOWN', violations: 0 };
    const a = afterSnapshot.pillars?.[pillar] || { status: 'UNKNOWN', violations: 0 };
    const icon = PILLAR_EMOJIS[pillar] || '🏛️';
    const isImproved = a.violations < b.violations || (b.status !== 'PASSED' && a.status === 'PASSED');
    const badge = isImproved ? '🟢 **RESOLVED**' : b.status === a.status ? '⚪ **UNCHANGED**' : '🔴 **DEGRADED**';
    lines.push(`| ${icon} ${pillar} | ${b.status} | ${a.status} | ${badge} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('### Community Takeaway');
  lines.push('Refactored using Chemical X Molecular Architecture standards. Monoliths decomposed into crystalline domain capsules (< 100 LOC) with self-cleaning hooks.');
  lines.push('');
  lines.push('*Transformation tracked via [Chemical X Protocol Starter Kit](https://github.com/Chemical-X-Protocol/awesome-secret-sauce).*');

  return {
    title,
    category,
    categorySlug,
    body: lines.join('\n')
  };
};

export const publishDiscussionViaHttp = async (token, repo, title, body, categoryName = DISCUSSION_CATEGORY) => {
  if (!token) return { success: false, url: null, error: 'No GitHub token provided' };

  const [owner, name] = repo.split('/');
  if (!owner || !name) return { success: false, url: null, error: `Invalid repository format: ${repo}` };

  try {
    const metaQuery = `
      query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          id
          discussionCategories(first: 25) {
            nodes {
              id
              name
              slug
              emoji
            }
          }
        }
      }
    `;

    const metaRes = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Chemical-X-Audit-CLI'
      },
      body: JSON.stringify({ query: metaQuery, variables: { owner, name } })
    });

    const metaJson = await metaRes.json();
    if (metaJson.errors) {
      return { success: false, url: null, error: metaJson.errors[0]?.message || 'GraphQL error fetching categories' };
    }

    const repositoryId = metaJson.data?.repository?.id;
    const categories = metaJson.data?.repository?.discussionCategories?.nodes || [];

    if (!repositoryId || categories.length === 0) {
      return { success: false, url: null, error: `Repository ${repo} has no discussions enabled` };
    }

    const matchedCat = categories.find((c) => c.name === categoryName)
      || categories.find((c) => c.slug === categoryName)
      || categories.find((c) => c.slug === DISCUSSION_CATEGORY_SLUG)
      || categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase())
      || categories.find((c) => c.slug.toLowerCase() === categoryName.toLowerCase())
      || categories.find((c) => c.name.toLowerCase().includes('chemx'))
      || categories.find((c) => c.slug.toLowerCase().includes('chemx'))
      || categories.find((c) => c.name.toLowerCase().includes('audit'))
      || categories.find((c) => c.slug.toLowerCase().includes('audit'))
      || categories.find((c) => c.name.toLowerCase().includes('general'))
      || categories[0];

    const mutation = `
      mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
        createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
          discussion {
            url
          }
        }
      }
    `;

    const postRes = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Chemical-X-Audit-CLI'
      },
      body: JSON.stringify({
        query: mutation,
        variables: { repositoryId, categoryId: matchedCat.id, title, body }
      })
    });

    const postJson = await postRes.json();
    if (postJson.errors) {
      return { success: false, url: null, error: postJson.errors[0]?.message || 'Failed creating discussion' };
    }

    const url = postJson.data?.createDiscussion?.discussion?.url;
    return { success: Boolean(url), url: url || null, error: null };
  } catch (err) {
    return { success: false, url: null, error: err.message };
  }
};

export const publishDiscussionViaGh = (repo, title, body, category = DISCUSSION_CATEGORY) => {
  try {
    let res = spawnSync(
      'gh',
      ['discussion', 'create', '-R', repo, '--title', title, '--body', body, '--category', category],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (res.status === 0) {
      return { success: true, url: (res.stdout || '').trim(), error: null };
    }

    const errText = (res.stderr || '').trim();

    // Fallback 1: Try category slug (e.g. 'npx-chemx-audit')
    if (errText.includes('category') && category !== DISCUSSION_CATEGORY_SLUG) {
      res = spawnSync(
        'gh',
        ['discussion', 'create', '-R', repo, '--title', title, '--body', body, '--category', DISCUSSION_CATEGORY_SLUG],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      if (res.status === 0) {
        return { success: true, url: (res.stdout || '').trim(), error: null };
      }
    }

    // Fallback 2: Try 'Audits'
    if (errText.includes('category') && category !== 'Audits') {
      res = spawnSync(
        'gh',
        ['discussion', 'create', '-R', repo, '--title', title, '--body', body, '--category', 'Audits'],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      if (res.status === 0) {
        return { success: true, url: (res.stdout || '').trim(), error: null };
      }
    }

    // Fallback 2: Try 'General' category
    if (errText.includes('category')) {
      res = spawnSync(
        'gh',
        ['discussion', 'create', '-R', repo, '--title', title, '--body', body, '--category', 'General'],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      if (res.status === 0) {
        return { success: true, url: (res.stdout || '').trim(), error: null };
      }
    }

    return { success: false, url: null, error: errText };
  } catch (err) {
    return { success: false, url: null, error: err.message };
  }
};

export const publishDiscussion = async (repo, title, body, category = DISCUSSION_CATEGORY) => {
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (envToken) {
    const httpResult = await publishDiscussionViaHttp(envToken, repo, title, body, category);
    if (httpResult.success) {
      return httpResult;
    }
  }

  return publishDiscussionViaGh(repo, title, body, category);
};
