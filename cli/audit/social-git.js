import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const safeSpawnSync = (command, args, options = {}) => {
  try {
    const optsWithDefaults = {
      timeout: 1000,
      ...options
    };
    const res = spawnSync(command, args, optsWithDefaults);
    if (res.error) {
      return [null, res.error];
    }
    return [res, null];
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return [null, error];
  }
};

const safeReadJson = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return [null, new Error(`File not found: ${filePath}`)];
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return [JSON.parse(raw), null];
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return [null, error];
  }
};

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
  const [res1] = safeSpawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  if (res1?.status === 0 && res1.stdout) {
    const parsed = parseGitRemoteUrl(res1.stdout);
    if (parsed) return parsed;
  }

  const [res2] = safeSpawnSync('git', ['config', '--get', 'remote.origin.url'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  if (res2?.status === 0 && res2.stdout) {
    const parsed = parseGitRemoteUrl(res2.stdout);
    if (parsed) return parsed;
  }

  const [remotesRes] = safeSpawnSync('git', ['remote'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  if (remotesRes?.status === 0 && remotesRes.stdout) {
    const firstRemote = (remotesRes.stdout.trim().split(/\s+/)[0] || '').trim();
    if (firstRemote) {
      const [urlRes] = safeSpawnSync('git', ['remote', 'get-url', firstRemote], {
        cwd,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      if (urlRes?.status === 0 && urlRes.stdout) {
        const parsed = parseGitRemoteUrl(urlRes.stdout);
        if (parsed) return parsed;
      }
    }
  }

  const pkgPath = path.resolve(cwd, 'package.json');
  const [pkg] = safeReadJson(pkgPath);
  if (pkg) {
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

  const [topRes] = safeSpawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  if (topRes?.status === 0 && topRes.stdout) {
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

  const [res] = safeSpawnSync('gh', ['api', 'user', '-q', '.login'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (res?.status === 0) {
    const user = (res.stdout || '').trim();
    if (user && /^[a-zA-Z0-9_\-]+$/.test(user)) return user;
  }

  const [statusRes] = safeSpawnSync('gh', ['auth', 'status'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (statusRes) {
    const output = `${statusRes.stdout || ''} ${statusRes.stderr || ''}`.trim();
    const match = output.match(/account\s+([a-zA-Z0-9_\-]+)/i) || output.match(/Logged in to [^\s]+ account ([a-zA-Z0-9_\-]+)/i);
    if (match && match[1]) {
      const user = match[1].trim();
      if (user && user !== 'default') return user;
    }
  }

  const [ghUser] = safeSpawnSync('git', ['config', 'github.user'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (ghUser?.stdout) {
    const u = ghUser.stdout.trim();
    if (u && /^[a-zA-Z0-9_\-]+$/.test(u)) return u;
  }

  const [gitRes] = safeSpawnSync('git', ['config', 'user.name'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (gitRes?.stdout) {
    const name = gitRes.stdout.trim();
    if (name && /^[a-zA-Z0-9_\-]+$/.test(name)) return name;
  }

  return 'Architect';
};

export const copyViaOsc52 = (text) => {
  if (typeof text !== 'string' || !text) return false;
  try {
    const base64 = Buffer.from(text, 'utf-8').toString('base64');
    const isTmux = Boolean(process.env.TMUX);
    const isScreen = Boolean(process.env.TERM && process.env.TERM.startsWith('screen'));

    let seq = `\x1b]52;c;${base64}\x07`;
    if (isTmux) {
      seq = `\x1bPtmux;\x1b\x1b]52;c;${base64}\x07\x1b\\`;
    } else if (isScreen) {
      seq = `\x1bP\x1b]52;c;${base64}\x07\x1b\\`;
    }

    if (process.stdout.isTTY) {
      process.stdout.write(seq);
      return true;
    }
    if (process.stderr.isTTY) {
      process.stderr.write(seq);
      return true;
    }
    try {
      const fd = fs.openSync('/dev/tty', 'w');
      fs.writeSync(fd, seq);
      fs.closeSync(fd);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
};

export const copyToClipboard = (text) => {
  if (typeof text !== 'string' || !text) return false;

  let copied = false;

  if (process.platform === 'darwin') {
    const [res] = safeSpawnSync('pbcopy', [], { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 1000 });
    if (res?.status === 0) copied = true;
  } else if (process.platform === 'win32') {
    const [res] = safeSpawnSync('clip', [], { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 1000 });
    if (res?.status === 0) copied = true;
  } else {
    // Linux / BSD / Unix environments
    const isWsl = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
    const isSommelier = Boolean(process.env.SOMMELIER_VM_IDENTIFIER || process.env.SOMMELIER_VERSION);

    if (isWsl) {
      const [wslRes] = safeSpawnSync('clip.exe', [], { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 1000 });
      if (wslRes?.status === 0) copied = true;
    }

    // wl-copy hangs in Sommelier / ChromeOS containers due to lack of unfocused data-control support
    if (!copied && !isSommelier) {
      const [wlWhich] = safeSpawnSync('which', ['wl-copy'], { stdio: 'ignore', timeout: 500 });
      if (wlWhich?.status === 0) {
        const [res] = safeSpawnSync('wl-copy', [], { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 800 });
        if (res?.status === 0) copied = true;
      }
    }

    if (!copied) {
      const [xcWhich] = safeSpawnSync('which', ['xclip'], { stdio: 'ignore', timeout: 500 });
      if (xcWhich?.status === 0) {
        const [res] = safeSpawnSync('xclip', ['-selection', 'clipboard'], { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 800 });
        if (res?.status === 0) copied = true;
      }
    }

    if (!copied) {
      const [xsWhich] = safeSpawnSync('which', ['xsel'], { stdio: 'ignore', timeout: 500 });
      if (xsWhich?.status === 0) {
        const [res] = safeSpawnSync('xsel', ['--clipboard', '--input'], { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 800 });
        if (res?.status === 0) copied = true;
      }
    }
  }

  // OSC 52 ANSI escape sequence: universally supported across modern terminal emulators
  // (ChromeOS Terminal, iTerm2, Alacritty, Kitty, WezTerm, VS Code, Windows Terminal, tmux, screen).
  // This provides zero-hang clipboard access over SSH, Crostini containers, Docker, and remote sessions.
  const oscCopied = copyViaOsc52(text);

  return copied || oscCopied;
};
