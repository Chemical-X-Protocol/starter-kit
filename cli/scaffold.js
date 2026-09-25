import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hasGum, gumInput, promptQuestion, renderBanner } from './terminal.js';
import { obtainLicenseKey, fetchStarterKitFiles, loadLocalBlueprintFiles } from './license.js';
import { runPillarsWizard } from './pillars-wizard.js';
import { resolvePackageManager } from './build/detector.js';
import { resolveFramework } from './project-detector.js';
import { getFrameworkConfig, buildScaffoldPackageJson } from './scaffold-frameworks.js';

const extractTargetName = (projectName, rawArgs) => {
  if (projectName && !projectName.startsWith('-')) return projectName;
  const isHeadless =
    rawArgs.includes('--headless') ||
    rawArgs.includes('--yes') ||
    rawArgs.includes('-y') ||
    rawArgs.includes('--ci') ||
    rawArgs.includes('--non-interactive') ||
    rawArgs.includes('--no-interactive') ||
    Boolean(process.env.CI) ||
    process.stdout?.isTTY === false ||
    process.stdin?.isTTY === false;

  return isHeadless ? 'my-molecular-app' : null;
};

export const runScaffold = async (projectName, rawArgs = [], onRunAudit = null) => {
  renderBanner('Chemical X: Molecular Architecture Scaffolder (npm create chemx)');

  const fwArg = (rawArgs.find((a) => a.startsWith('--framework=')) || '').split('=')[1]
    || (rawArgs.includes('--framework') ? rawArgs[rawArgs.indexOf('--framework') + 1] : null);
  const frameworkId = resolveFramework({ frameworkArg: fwArg, cwd: process.cwd() });
  const fwConfig = getFrameworkConfig(frameworkId);

  const licenseKey = await obtainLicenseKey(rawArgs, onRunAudit);
  let rawFiles = {};

  if (!licenseKey) {
    process.stdout.write(
      '\n\x1b[38;2;98;201;255m⚡ Chemical X: Community Edition (Free)\x1b[0m\n' +
      'Open-source molecular architecture standard for high-velocity AI coding.\n' +
      `Framework Flavor: \x1b[1m\x1b[36m${fwConfig.name}\x1b[0m\n\n`
    );
    rawFiles = loadLocalBlueprintFiles();
  } else {
    rawFiles = await fetchStarterKitFiles(licenseKey);
  }

  let targetName = extractTargetName(projectName, rawArgs);
  if (!targetName) {
    targetName = hasGum()
      ? gumInput('Project directory name:', 'my-molecular-app')
      : await promptQuestion('Project directory name [my-molecular-app]: ');
  }

  const finalDirName = (targetName || 'my-molecular-app').trim();
  const targetDir = path.resolve(process.cwd(), finalDirName);

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    process.stderr.write(`\x1b[31m✕ Error: Directory '${finalDirName}' already exists and is not empty.\x1b[0m\n`);
    process.exit(1);
  }

  const resolveScaffoldTarget = (rel) => {
    if (rel === '_package.json') return 'package.json';
    if (rel === '_tsconfig.json') return 'tsconfig.json';
    if (rel === '_vitest.config.ts') return 'vitest.config.ts';
    if (rel === '_gitignore') return '.gitignore';
    return rel;
  };

  process.stdout.write(`Scaffolding ${fwConfig.name} Molecular Architecture into: \x1b[36m${finalDirName}/\x1b[0m\n`);
  fs.mkdirSync(targetDir, { recursive: true });

  const scaffoldFiles = {};
  for (const rel of fwConfig.files) {
    if (rawFiles[rel] !== undefined) {
      scaffoldFiles[rel] = rawFiles[rel];
    }
  }

  scaffoldFiles['_package.json'] = JSON.stringify(buildScaffoldPackageJson(finalDirName, fwConfig), null, 2) + '\n';
  scaffoldFiles['.chemx/config.json'] = JSON.stringify({ framework: fwConfig.id }, null, 2) + '\n';

  for (const [relPath, content] of Object.entries(scaffoldFiles)) {
    const isForbidden = fwConfig.forbiddenExtensions.some((ext) => relPath.endsWith(ext));
    if (isForbidden) continue;

    const targetRel = resolveScaffoldTarget(relPath);
    const fullPath = path.join(targetDir, targetRel);
    const dirName = path.dirname(fullPath);
    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(dirName, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf-8');
    process.stdout.write(`  \x1b[32m✔\x1b[0m ${targetRel}\n`);
  }

  const isYes = rawArgs.includes('-y') || rawArgs.includes('--yes') || !process.stdin.isTTY;
  await runPillarsWizard(isYes ? ['--preset=recommended', '-y'] : [], targetDir);

  const pm = resolvePackageManager(targetDir);
  const autoInstall = rawArgs.includes('--install');
  let installDone = false;

  if (autoInstall) {
    process.stdout.write(`\nInstalling dependencies via \x1b[36m${pm} install\x1b[0m...\n`);
    const installRes = spawnSync(pm, ['install'], { cwd: targetDir, stdio: 'inherit' });
    installDone = installRes.status === 0;
  }

  process.stdout.write(
    `\n\x1b[1m\x1b[32m✔ Molecular Architecture project created successfully at ${finalDirName}!\x1b[0m\n\n`
  );
  process.stdout.write('Next Steps:\n');
  if (installDone) {
    process.stdout.write(`  1. cd ${finalDirName}\n`);
  } else {
    process.stdout.write(`  1. cd ${finalDirName} && ${pm} install\n`);
  }
  process.stdout.write('  2. Review AGENTS.md for line budgets and architecture standards\n');
  process.stdout.write('  3. Run npx chemx generate m-<feature> to create capsules\n');
  process.stdout.write('  4. Run npx chemx audit to scan for line budget compliance\n');
  process.stdout.write('  5. Run npx chemx verify to verify AST rules, typecheck, and tests\n\n');
};

export const runInit = async (targetSubDir = 'src/chemical-x', rawArgs = [], onRunAudit = null) => {
  renderBanner('Chemical X: In-Repo Capsule Drop-in');

  const targetDir = path.resolve(process.cwd(), targetSubDir);
  const licenseKey = await obtainLicenseKey(rawArgs, onRunAudit);
  let files = {};

  if (!licenseKey) {
    process.stdout.write(
      '\n\x1b[38;2;98;201;255m⚡ Chemical X: Community Drop-in (Free)\x1b[0m\n' +
      'Unpacking standard blueprints for your project. Support community standards: chemicalx.xophz.com\n\n'
    );
    files = loadLocalBlueprintFiles();
  } else {
    files = await fetchStarterKitFiles(licenseKey);
  }

  process.stdout.write(`Unpacking blueprints and hooks into: \x1b[36m${targetSubDir}/\x1b[0m\n`);

  let count = 0;
  for (const [relPath, content] of Object.entries(files)) {
    const isConfigBlueprint = ['_package.json', '_tsconfig.json', '_vitest.config.ts'].includes(relPath);
    if (isConfigBlueprint) {
      continue;
    }
    const fullPath = path.join(targetDir, relPath);
    const dirName = path.dirname(fullPath);
    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(dirName, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf-8');
    process.stdout.write(`  \x1b[32m✔\x1b[0m ${relPath}\n`);
    count++;
  }

  process.stdout.write(
    `\n\x1b[1m\x1b[32m✔ Successfully installed ${count} Chemical X assets into ${targetSubDir}!\x1b[0m\n\n`
  );
};

export { runGenerateCapsule, runGenerateWizard } from './generator.js';
export { printHelp } from './help.js';
