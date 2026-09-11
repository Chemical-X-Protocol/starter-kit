import fs from 'node:fs';
import path from 'node:path';
import { hasGum, gumInput, promptQuestion, renderBanner } from './terminal.js';
import { obtainLicenseKey, fetchStarterKitFiles, checkOrPromptEvaluation } from './license.js';

export const runScaffold = async (projectName, rawArgs = [], onRunAudit = null) => {
  renderBanner('Chemical X: Molecular Architecture Scaffolder (npm create chemx)');

  const licenseKey = await obtainLicenseKey(rawArgs, onRunAudit);
  if (!licenseKey) {
    process.stderr.write('\x1b[31m✕ Valid license key is required to scaffold blueprints.\x1b[0m\n');
    process.exit(1);
  }

  let targetName = projectName;
  if (!targetName) {
    targetName = hasGum()
      ? gumInput('Project directory name:', 'my-molecular-app')
      : await promptQuestion('Project directory name [my-molecular-app]: ');
  }

  const finalDirName = targetName.trim() || 'my-molecular-app';
  const targetDir = path.resolve(process.cwd(), finalDirName);

  const dirExists = fs.existsSync(targetDir);
  const isDirNonEmpty = dirExists && fs.readdirSync(targetDir).length > 0;
  if (isDirNonEmpty) {
    process.stderr.write(`\x1b[31m✕ Error: Directory '${finalDirName}' already exists and is not empty.\x1b[0m\n`);
    process.exit(1);
  }

  const files = await fetchStarterKitFiles(licenseKey);

  process.stdout.write(`Scaffolding Molecular Architecture into: \x1b[36m${finalDirName}/\x1b[0m\n`);
  fs.mkdirSync(targetDir, { recursive: true });

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(targetDir, relPath);
    const dirName = path.dirname(fullPath);
    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(dirName, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf-8');
    process.stdout.write(`  \x1b[32m✔\x1b[0m ${relPath}\n`);
  }

  const cursorRulesPath = path.join(targetDir, '.cursorrules');
  if (!fs.existsSync(cursorRulesPath)) {
    const rules = '# Chemical X Molecular Architecture Directives\nStrictly follow AGENTS.md rules. Never exceed 500 lines per file. All molecule capsules must stay under 100 lines.\n';
    fs.writeFileSync(cursorRulesPath, rules, 'utf-8');
    process.stdout.write('  \x1b[32m✔\x1b[0m .cursorrules\n');
  }

  process.stdout.write(
    `\n\x1b[1m\x1b[32m✔ Molecular Architecture project created successfully at ${finalDirName}!\x1b[0m\n\n`
  );
  process.stdout.write('Next Steps:\n');
  process.stdout.write(`  1. cd ${finalDirName}\n`);
  process.stdout.write('  2. Review AGENTS.md for line budgets and architecture standards\n');
  process.stdout.write('  3. Run npx chemx generate m-<feature> to create capsules\n');
  process.stdout.write('  4. Run npx chemx audit to scan for line budget compliance\n\n');
};

export const runInit = async (targetSubDir = 'src/chemical-x', rawArgs = [], onRunAudit = null) => {
  renderBanner('Chemical X: In-Repo Capsule Drop-in');

  const targetDir = path.resolve(process.cwd(), targetSubDir);
  const licenseKey = await obtainLicenseKey(rawArgs, onRunAudit);
  if (!licenseKey) {
    process.stderr.write('\x1b[31m✕ Valid license key is required.\x1b[0m\n');
    process.exit(1);
  }

  const files = await fetchStarterKitFiles(licenseKey);

  process.stdout.write(`Unpacking blueprints and hooks into: \x1b[36m${targetSubDir}/\x1b[0m\n`);

  let count = 0;
  for (const [relPath, content] of Object.entries(files)) {
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

export const runGenerateCapsule = async (capsuleName) => {
  await checkOrPromptEvaluation('generate capsule');

  const normalizedName = capsuleName.startsWith('m-') ? capsuleName : `m-${capsuleName}`;
  const targetDir = path.resolve(process.cwd(), normalizedName);

  if (fs.existsSync(targetDir)) {
    process.stderr.write(`\x1b[31m✕ Error: Directory ${normalizedName} already exists.\x1b[0m\n`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const pascalName = normalizedName
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');

  const componentCode = `import React from 'react';
import type { ${pascalName}Props } from './types';

export const ${pascalName}: React.FC<${pascalName}Props> = ({ label }) => {
  return (
    <div className="${normalizedName}">
      <span>{label}</span>
    </div>
  );
};

export default ${pascalName};
`;

  const typesCode = `export interface ${pascalName}Props {
  readonly label: string;
}
`;

  const indexCode = `export { ${pascalName} } from './${normalizedName}';
export type { ${pascalName}Props } from './types';
`;

  fs.writeFileSync(path.join(targetDir, `${normalizedName}.tsx`), componentCode, 'utf-8');
  fs.writeFileSync(path.join(targetDir, 'types.d.ts'), typesCode, 'utf-8');
  fs.writeFileSync(path.join(targetDir, 'index.ts'), indexCode, 'utf-8');

  process.stdout.write(
    `\x1b[32m✔ Successfully generated crystalline capsule:\x1b[0m ${normalizedName}/\n`
  );
  process.stdout.write(`  - ${normalizedName}/${normalizedName}.tsx (< 50 lines)\n`);
  process.stdout.write(`  - ${normalizedName}/types.d.ts\n`);
  process.stdout.write(`  - ${normalizedName}/index.ts\n\n`);
};

export { printHelp } from './help.js';
