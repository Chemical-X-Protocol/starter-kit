import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

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
