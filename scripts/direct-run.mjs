import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Node resolves symlinks in import.meta.url but leaves argv[1] as typed, so both sides are realpath'd.
export const isDirectRun = (argv1, moduleUrl) => {
  const hasInvokedFile = Boolean(argv1) && fs.existsSync(argv1);
  if (!hasInvokedFile) return false;
  return fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(moduleUrl));
};
