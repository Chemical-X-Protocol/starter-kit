/**
 * `chemx ui` opens the dashboard in the default browser at its token URL (#7643), so nobody copies a token by hand.
 * Skipped with --no-open or CHEMX_UI_NO_OPEN=1, in CI, when stdout is not a terminal, and on Linux with no display.
 * Opening is best effort: a missing opener prints nothing and the printed URL still works.
 */
import { spawn } from 'node:child_process';

const OPENERS = { darwin: ['open'], win32: ['cmd', '/c', 'start', '""'], linux: ['xdg-open'] };

/** Why the browser should not be opened, or '' when it should. */
export const skipOpenReason = ({ argv = process.argv, env = process.env, isTty = Boolean(process.stdout.isTTY), platform = process.platform } = {}) => {
  const checks = [
    [argv.includes('--no-open'), '--no-open'],
    [env.CHEMX_UI_NO_OPEN === '1', 'CHEMX_UI_NO_OPEN=1'],
    [Boolean(env.CI), 'CI'],
    [!isTty, 'not a terminal'],
    [platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY, 'no display'],
    [!OPENERS[platform], `no opener for ${platform}`]
  ];
  const hit = checks.find(([isSkip]) => isSkip);
  return hit ? hit[1] : '';
};

export const openInBrowser = (url, options = {}) => {
  const reason = skipOpenReason(options);
  if (reason) return { opened: false, reason };
  const [cmd, ...args] = OPENERS[options.platform || process.platform];
  const child = (options.spawn || spawn)(cmd, [...args, url], { detached: true, stdio: 'ignore' });
  child.on?.('error', () => {}); // chemx-allow: no opener installed; the URL is already printed
  child.unref?.();
  return { opened: true, reason: '' };
};
