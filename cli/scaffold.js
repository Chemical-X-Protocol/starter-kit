import fs from 'node:fs';
import path from 'node:path';
import { hasGum, gumInput, promptQuestion, renderBanner } from './terminal.js';
import { obtainLicenseKey, fetchStarterKitFiles, loadLocalBlueprintFiles } from './license.js';
import { runPillarsWizard } from './pillars-wizard.js';

export const runScaffold = async (projectName, rawArgs = [], onRunAudit = null) => {
  renderBanner('Chemical X: Molecular Architecture Scaffolder (npm create chemx)');

  const licenseKey = await obtainLicenseKey(rawArgs, onRunAudit);
  let isCommunity = false;
  let files = {};

  if (!licenseKey) {
    process.stdout.write(
      '\n\x1b[38;2;98;201;255m⚡ Chemical X: Community Edition (Free)\x1b[0m\n' +
      'Open-source molecular architecture standard for high-velocity AI coding.\n' +
      'Scorecards can be shared with the community via PR checks or the share menu.\n' +
      'No background telemetry is exfiltrated without your explicit consent.\n' +
      'Thank you for supporting Chemical X!\n\n'
    );
    files = loadLocalBlueprintFiles();
    isCommunity = true;
  } else {
    files = await fetchStarterKitFiles(licenseKey);
  }

  let targetName = (projectName && !projectName.startsWith('-')) ? projectName : null;
  if (!targetName) {
    const isHeadless =
      rawArgs.includes('--headless') ||
      rawArgs.includes('--yes') ||
      rawArgs.includes('-y') ||
      rawArgs.includes('--ci') ||
      rawArgs.includes('--non-interactive') ||
      rawArgs.includes('--no-interactive') ||
      Boolean(process.env.CI) ||
      process.stdout?.isTTY === false ||
      process.stdin?.isTTY === false ||
      Boolean(process.argv?.some((arg) => arg === '--headless' || arg === '--ci' || arg === '--yes' || arg === '-y'));

    if (isHeadless) {
      targetName = 'my-molecular-app';
    } else {
      targetName = hasGum()
        ? gumInput('Project directory name:', 'my-molecular-app')
        : await promptQuestion('Project directory name [my-molecular-app]: ');
    }
  }

  const finalDirName = targetName.trim() || 'my-molecular-app';
  const targetDir = path.resolve(process.cwd(), finalDirName);

  const dirExists = fs.existsSync(targetDir);
  const isDirNonEmpty = dirExists && fs.readdirSync(targetDir).length > 0;
  if (isDirNonEmpty) {
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

  process.stdout.write(`Scaffolding Molecular Architecture into: \x1b[36m${finalDirName}/\x1b[0m\n`);
  fs.mkdirSync(targetDir, { recursive: true });

  for (const [relPath, content] of Object.entries(files)) {
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

  process.stdout.write(
    `\n\x1b[1m\x1b[32m✔ Molecular Architecture project created successfully at ${finalDirName}!\x1b[0m\n\n`
  );
  process.stdout.write('Next Steps:\n');
  process.stdout.write(`  1. cd ${finalDirName}\n`);
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
    if (relPath === '_package.json' || relPath === '_tsconfig.json' || relPath === '_vitest.config.ts') {
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

