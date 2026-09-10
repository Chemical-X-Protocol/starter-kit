import readline from 'node:readline';
import { spawnSync } from 'node:child_process';

export const openBrowser = (url) => {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      spawnSync('open', [url], { stdio: 'ignore' });
    } else if (platform === 'win32') {
      spawnSync('cmd.exe', ['/c', 'start', '""', url], { stdio: 'ignore' });
    } else {
      spawnSync('xdg-open', [url], { stdio: 'ignore' });
    }
  } catch {}
};

export const hasGum = () => {
  try {
    return spawnSync('which', ['gum'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
};

export const gumChoose = (options, header = '') => {
  const args = ['choose'];
  if (header) {
    args.push(`--header=${header}`, '--header.foreground=81');
  }
  const headerPadding = header ? 3 : 1;
  const listHeight = options.length + headerPadding;
  args.push('--cursor.foreground=81', `--height=${listHeight}`, ...options);
  const res = spawnSync('gum', args, { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'inherit'] });
  return (res.stdout || '').trim();
};

export const gumInput = (promptText, placeholder = '', isPassword = false) => {
  const args = ['input', `--prompt=${promptText} `, `--placeholder=${placeholder}`];
  if (isPassword) {
    args.push('--password');
  }
  const res = spawnSync('gum', args, { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'inherit'] });
  return (res.stdout || '').trim();
};

export const promptQuestion = (query) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
};

export const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');

export const renderBanner = (title = 'Chemical X Protocol: Molecular Architecture') => {
  if (hasGum()) {
    spawnSync(
      'gum',
      [
        'style',
        '--border=normal',
        '--margin=1',
        '--padding=1 2',
        '--border-foreground=45',
        '--foreground=81',
        '--bold',
        `  ${title}\n  Zero-Context-Rot Scaffolding & Engineering Directives`
      ],
      { stdio: 'inherit' }
    );
  } else {
    process.stdout.write('\n\x1b[38;2;98;201;255m=====================================================\x1b[0m\n');
    process.stdout.write(`\x1b[1m\x1b[38;2;98;201;255m  ${title}\x1b[0m\n`);
    process.stdout.write('  Zero-Context-Rot Scaffolding & Engineering Directives\n');
    process.stdout.write('\x1b[38;2;98;201;255m=====================================================\x1b[0m\n\n');
  }
};
