import fs from 'node:fs';
import path from 'node:path';

const RELEVANT_EXTS = new Set(['.html', '.js', '.css', '.vue', '.scss', '.json']);

const isRelevantFile = (filename) => {
  if (!filename) return false;
  const isSpec = filename.endsWith('.spec.js');
  const isModule = filename.includes('node_modules');
  const isExtensionValid = RELEVANT_EXTS.has(path.extname(filename));
  const isExcluded = isSpec || isModule;
  return isExtensionValid && !isExcluded;
};

export const startUiDevWatcher = (cwd = process.cwd(), onReload) => {
  const watchTargets = [
    path.resolve(cwd, 'cli'),
    path.resolve(cwd, 'src/ui')
  ].filter((dir) => fs.existsSync(dir));

  const watchers = [];
  let activeTimer = null;

  const cancelTimer = () => {
    if (activeTimer) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }
  };

  const triggerReload = (target, filename) => {
    if (!isRelevantFile(filename)) return () => {};
    cancelTimer();
    activeTimer = setTimeout(() => {
      process.stdout.write(`\x1b[35m⚡ [Chemical X Dev]\x1b[0m Hot-reloading due to: ${filename || target}\n`);
      if (typeof onReload === 'function') onReload(filename);
      activeTimer = null;
    }, 50);
    return () => cancelTimer();
  };

  for (const target of watchTargets) {
    const watcher = fs.watch(target, { recursive: true }, (event, filename) => {
      triggerReload(target, filename);
    });
    watcher.on('error', (err) => {
      process.stderr.write(`[Watcher Error] ${target}: ${err.message}\n`);
    });
    watchers.push(watcher);
  }

  return {
    watchers,
    close: () => {
      cancelTimer();
      for (const w of watchers) {
        w.close();
      }
    }
  };
};
