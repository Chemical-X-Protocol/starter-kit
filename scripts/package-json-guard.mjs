// Keeps a rewritten package.json from outliving the process that rewrote it.
//
// publish-both rewrites package.json once per target. Restoring it in a `finally` misses a Ctrl-C
// at npm's OTP prompt, because the default signal action ends Node before any finally runs. This
// module restores on every exit path: normal end, process.exit, an uncaught error, and SIGINT,
// SIGTERM or SIGHUP.

import fs from 'node:fs';
import os from 'node:os';

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Arms the restore for `file`, which must already hold `original`. Returns an idempotent `restore`.
 * `stopChild` runs on a signal, before the restore, so a running child process is not left behind.
 */
export function restoreOnExit(file, original, { stopChild = () => {}, proc = process } = {}) {
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    fs.writeFileSync(file, original, 'utf-8');
  };

  proc.once('exit', restore);
  for (const signal of SIGNALS) {
    proc.once(signal, () => {
      stopChild(signal);
      restore();
      proc.exit(128 + os.constants.signals[signal]);
    });
  }

  return restore;
}
