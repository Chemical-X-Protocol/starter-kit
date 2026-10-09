// Spec helper: point HOME and XDG_CONFIG_HOME at a throwaway dir so specs never touch the
// developer's real ~/.config/chemx or ~/.chemical-x. Import it first in any spec that reaches license code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const createIsolatedHome = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-home-'));
  return { home, xdg: path.join(home, '.config') };
};

const isolated = createIsolatedHome();
process.env.HOME = isolated.home;
process.env.XDG_CONFIG_HOME = isolated.xdg;
delete process.env.CHEMX_LICENSE_KEY;

export const ISOLATED_HOME = isolated.home;
