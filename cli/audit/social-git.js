import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isStdoutTty, isStderrTty } from '../terminal.js';

const safeSpawnSync = (command, args, options = {}) => {
  try {
    const optsWithDefaults = {
      timeout: 1000,
      ...options
    };
    const res = spawnSync(command, args, optsWithDefaults);
    const hasSpawnError = Boolean(res.error);
    if (hasSpawnError) {
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
    const isMissingFile = !fs.existsSync(filePath);
    if (isMissingFile) {
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
  const isInvalidUrl = !url || typeof url !== 'string';
  if (isInvalidUrl) return null;
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
  const hasOriginUrl = Boolean(res1?.status === 0 && res1.stdout);
  if (hasOriginUrl) {
    const parsed = parseGitRemoteUrl(res1.stdout);
    if (parsed) return parsed;
  }

  const [res2] = safeSpawnSync('git', ['config', '--get', 'remote.origin.url'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  const hasConfigUrl = Boolean(res2?.status === 0 && res2.stdout);
  if (hasConfigUrl) {
    const parsed = parseGitRemoteUrl(res2.stdout);
    if (parsed) return parsed;
  }

  const [remotesRes] = safeSpawnSync('git', ['remote'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  const hasRemotes = Boolean(remotesRes?.status === 0 && remotesRes.stdout);
  if (hasRemotes) {
    const firstRemote = (remotesRes.stdout.trim().split(/\s+/)[0] || '').trim();
    if (firstRemote) {
      const [urlRes] = safeSpawnSync('git', ['remote', 'get-url', firstRemote], {
        cwd,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const hasRemoteUrl = Boolean(urlRes?.status === 0 && urlRes.stdout);
      if (hasRemoteUrl) {
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
    const hasPkgName = Boolean(pkg.name);
    if (hasPkgName) {
      const isScopedPkgName = pkg.name.startsWith('@') && pkg.name.includes('/');
      if (isScopedPkgName) {
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
  const hasTopLevel = Boolean(topRes?.status === 0 && topRes.stdout);
  if (hasTopLevel) {
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
  const hasPreferredUser = Boolean(preferredUser && typeof preferredUser === 'string');
  if (hasPreferredUser) {
    const trimmed = preferredUser.trim();
    const isUsablePreferred = Boolean(trimmed && trimmed !== 'Architect');
    if (isUsablePreferred) return trimmed;
  }

  const [res] = safeSpawnSync('gh', ['api', 'user', '-q', '.login'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  const isGhApiOk = Boolean(res?.status === 0);
  if (isGhApiOk) {
    const user = (res.stdout || '').trim();
    const isValidLogin = Boolean(user && /^[a-zA-Z0-9_\-]+$/.test(user));
    if (isValidLogin) return user;
  }

  const [statusRes] = safeSpawnSync('gh', ['auth', 'status'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  const hasStatusRes = Boolean(statusRes);
  if (hasStatusRes) {
    const output = `${statusRes.stdout || ''} ${statusRes.stderr || ''}`.trim();
    const match = output.match(/account\s+([a-zA-Z0-9_\-]+)/i) || output.match(/Logged in to [^\s]+ account ([a-zA-Z0-9_\-]+)/i);
    const hasAccountMatch = Boolean(match && match[1]);
    if (hasAccountMatch) {
      const user = match[1].trim();
      const isRealAccount = Boolean(user && user !== 'default');
      if (isRealAccount) return user;
    }
  }

  const [ghUser] = safeSpawnSync('git', ['config', 'github.user'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  const hasGhUserConfig = Boolean(ghUser?.stdout);
  if (hasGhUserConfig) {
    const u = ghUser.stdout.trim();
    const isValidConfigUser = Boolean(u && /^[a-zA-Z0-9_\-]+$/.test(u));
    if (isValidConfigUser) return u;
  }

  const [gitRes] = safeSpawnSync('git', ['config', 'user.name'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  const hasGitUserName = Boolean(gitRes?.stdout);
  if (hasGitUserName) {
    const name = gitRes.stdout.trim();
    const isValidGitName = Boolean(name && /^[a-zA-Z0-9_\-]+$/.test(name));
    if (isValidGitName) return name;
  }

  return 'Architect';
};

export const copyViaOsc52 = (text) => {
  const isEmptyText = typeof text !== 'string' || !text;
  if (isEmptyText) return false;
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

    if (isStdoutTty()) {
      process.stdout.write(seq);
      return true;
    }
    if (isStderrTty()) {
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

export const copyToClipboard = (text, options = {}) => {
  const isEmptyText = typeof text !== 'string' || !text;
  if (isEmptyText) return false;
  const isTestRun = Boolean(options.dryRun || process.env.NODE_ENV === 'test' || process.env.CHEMX_TEST === '1' || process.env.VITEST);
  if (isTestRun) {
    return true;
  }

  let copied = false;

  const isDarwin = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  if (isDarwin) {
    const [res] = safeSpawnSync('pbcopy', [], { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 1000 });
    const didCopy = res?.status === 0;
    if (didCopy) copied = true;
  } else if (isWindows) {
    const [res] = safeSpawnSync('clip', [], { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 1000 });
    const didCopy = res?.status === 0;
    if (didCopy) copied = true;
  } else {
    // Linux / BSD / Unix environments
    const isWsl = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
    const isSommelier = Boolean(process.env.SOMMELIER_VM_IDENTIFIER || process.env.SOMMELIER_VERSION);

    if (isWsl) {
      const [wslRes] = safeSpawnSync('clip.exe', [], { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 1000 });
      const didWslCopy = wslRes?.status === 0;
      if (didWslCopy) copied = true;
    }

    // wl-copy hangs in Sommelier / ChromeOS containers due to lack of unfocused data-control support
    const shouldTryWlCopy = !copied && !isSommelier;
    if (shouldTryWlCopy) {
      const [wlWhich] = safeSpawnSync('which', ['wl-copy'], { stdio: 'ignore', timeout: 500 });
      const hasWlCopy = wlWhich?.status === 0;
      if (hasWlCopy) {
        const [res] = safeSpawnSync('wl-copy', [], { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 800 });
        const didCopy = res?.status === 0;
        if (didCopy) copied = true;
      }
    }

    const shouldTryXclip = !copied;
    if (shouldTryXclip) {
      const [xcWhich] = safeSpawnSync('which', ['xclip'], { stdio: 'ignore', timeout: 500 });
      const hasXclip = xcWhich?.status === 0;
      if (hasXclip) {
        const [res] = safeSpawnSync('xclip', ['-selection', 'clipboard'], { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 800 });
        const didCopy = res?.status === 0;
        if (didCopy) copied = true;
      }
    }

    const shouldTryXsel = !copied;
    if (shouldTryXsel) {
      const [xsWhich] = safeSpawnSync('which', ['xsel'], { stdio: 'ignore', timeout: 500 });
      const hasXsel = xsWhich?.status === 0;
      if (hasXsel) {
        const [res] = safeSpawnSync('xsel', ['--clipboard', '--input'], { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 800 });
        const didCopy = res?.status === 0;
        if (didCopy) copied = true;
      }
    }
  }

  // OSC 52 ANSI escape sequence: universally supported across modern terminal emulators
  // (ChromeOS Terminal, iTerm2, Alacritty, Kitty, WezTerm, VS Code, Windows Terminal, tmux, screen).
  // This provides zero-hang clipboard access over SSH, Crostini containers, Docker, and remote sessions.
  const oscCopied = copyViaOsc52(text);

  return copied || oscCopied;
};
