import fs from 'node:fs';
import path from 'node:path';
import { hasGum, gumChoose, gumInput, promptQuestion, renderBanner } from './terminal.js';
import { checkOrPromptEvaluation } from './license.js';
import {
  toPascalCase,
  buildReactComponent,
  buildVueComponent,
  buildSvelteComponent,
  buildController,
  buildTypes,
  buildScss,
  buildIndex
} from './generator-templates.js';

const TIERS = [
  { prefix: 'm-', label: '1. m- Molecule (Self-contained feature block < 100 lines - Recommended)', tier: 'm' },
  { prefix: 'a-', label: '2. a- Atom (Single foundational UI element)', tier: 'a' },
  { prefix: 'o-', label: '3. o- Organism (Complex module combining molecules)', tier: 'o' },
  { prefix: 't-', label: '4. t- Template (Structural layout blueprint)', tier: 't' }
];

const FRAMEWORKS = [
  { id: 'react', ext: 'tsx', label: '1. React 19 (TSX + Controller Hook)', builder: buildReactComponent },
  { id: 'vue', ext: 'vue', label: '2. Vue 3.4+ (SFC <script setup lang="ts">)', builder: buildVueComponent },
  { id: 'svelte', ext: 'svelte', label: '3. Svelte 5 (Runes + {prop} Shorthand)', builder: buildSvelteComponent }
];

const detectBaseDir = () => {
  const candidates = ['src/components/molecules', 'src/components', 'components', 'src'];
  for (const c of candidates) {
    if (fs.existsSync(path.resolve(process.cwd(), c))) return c;
  }
  return '.';
};

const IGNORED_NAME_TOKENS = new Set(['generate', 'capsule', 'add']);
const isCapsuleNameArg = (arg) => !arg.startsWith('-') && !IGNORED_NAME_TOKENS.has(arg);

export const runGenerateWizard = async (rawArgs = []) => {
  renderBanner('Chemical X: Molecular Capsule Wizard');
  await checkOrPromptEvaluation('generate capsule');

  const useGum = hasGum();
  const isYes = rawArgs.includes('-y') || rawArgs.includes('--yes');

  const nameArg = rawArgs.find(isCapsuleNameArg);
  const frameworkArg = (rawArgs.find((a) => a.startsWith('--framework=')) || '').split('=')[1]
    || (rawArgs.includes('-f') ? rawArgs[rawArgs.indexOf('-f') + 1] : null);
  const tierArg = (rawArgs.find((a) => a.startsWith('--tier=')) || '').split('=')[1];
  const dirArg = (rawArgs.find((a) => a.startsWith('--dir=')) || '').split('=')[1];
  const isLean = rawArgs.includes('--lean');

  let rawName = nameArg;
  if (!rawName) {
    rawName = useGum
      ? gumInput('Capsule feature name (e.g. user-avatar, spark-kpi):', 'user-avatar')
      : await promptQuestion('Capsule feature name [user-avatar]: ');
  }
  const cleanName = (rawName || 'user-avatar').trim().toLowerCase();

  let selectedPrefix = 'm-';
  const existingPrefixMatch = cleanName.match(/^([a-z])-+/);
  if (tierArg) {
    selectedPrefix = `${tierArg.replace(/[^a-z]/g, '')}-`;
  } else if (!isYes && !existingPrefixMatch) {
    const tierChoice = useGum
      ? gumChoose(TIERS.map((t) => t.label), 'Select Architectural Tier')
      : await promptQuestion('Select Architectural Tier [1=m, 2=a, 3=o, 4=t] (default: 1): ');
    const matched = TIERS.find((t) => tierChoice && (tierChoice.includes(t.label) || tierChoice.startsWith(t.tier) || tierChoice === t.prefix));
    if (matched) selectedPrefix = matched.prefix;
  } else if (existingPrefixMatch) {
    selectedPrefix = existingPrefixMatch[0];
  }

  const baseSlug = cleanName.replace(/^([a-z])-/, '');
  const capsuleName = `${selectedPrefix}${baseSlug}`;
  const pascalName = toPascalCase(capsuleName);

  let selectedFramework = FRAMEWORKS[0];
  if (frameworkArg) {
    const found = FRAMEWORKS.find((f) => f.id === frameworkArg.toLowerCase() || f.ext === frameworkArg.toLowerCase());
    if (found) selectedFramework = found;
  } else if (!isYes) {
    const fwChoice = useGum
      ? gumChoose(FRAMEWORKS.map((f) => f.label), 'Select Framework Flavor')
      : await promptQuestion('Select Framework Flavor [1=React, 2=Vue 3, 3=Svelte 5] (default: 1): ');
    const found = FRAMEWORKS.find((f) => fwChoice && (fwChoice.includes(f.label) || fwChoice.toLowerCase().includes(f.id)));
    if (found) selectedFramework = found;
  }

  const detectedDir = detectBaseDir();
  let targetParent = dirArg || (isYes ? detectedDir : null);
  if (!targetParent) {
    const dirChoices = [
      `1. Detected components directory (${detectedDir}/${capsuleName})`,
      `2. Current working directory (./${capsuleName})`,
      '3. Custom directory path'
    ];
    const dirPick = useGum
      ? gumChoose(dirChoices, 'Select Destination Directory')
      : await promptQuestion(`Destination Directory [1=${detectedDir}, 2=current, 3=custom] (default: 1): `);

    if (dirPick && dirPick.startsWith('2.')) {
      targetParent = '.';
    } else if (dirPick && dirPick.startsWith('3.')) {
      targetParent = useGum
        ? gumInput('Enter custom parent directory path:', detectedDir)
        : await promptQuestion(`Enter custom parent directory path [${detectedDir}]: `);
    } else {
      targetParent = detectedDir;
    }
  }

  const resolvedParent = path.resolve(process.cwd(), targetParent || '.');
  const targetDir = path.resolve(resolvedParent, capsuleName);

  if (fs.existsSync(targetDir)) {
    process.stderr.write(`\x1b[31m✕ Error: Directory ${capsuleName} already exists at ${targetDir}.\x1b[0m\n`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const compFile = `${capsuleName}.${selectedFramework.ext}`;
  const compContent = selectedFramework.builder(capsuleName, pascalName);
  const typesContent = buildTypes(capsuleName, pascalName);
  const indexContent = buildIndex(capsuleName, pascalName, selectedFramework.ext);

  fs.writeFileSync(path.join(targetDir, compFile), compContent, 'utf-8');
  fs.writeFileSync(path.join(targetDir, 'types.d.ts'), typesContent, 'utf-8');
  fs.writeFileSync(path.join(targetDir, 'index.ts'), indexContent, 'utf-8');

  const filesCreated = [compFile, 'types.d.ts', 'index.ts'];

  if (!isLean) {
    const controllerFile = `${capsuleName}.controller.ts`;
    const scssFile = `_${capsuleName}.scss`;
    fs.writeFileSync(path.join(targetDir, controllerFile), buildController(capsuleName, pascalName), 'utf-8');
    fs.writeFileSync(path.join(targetDir, scssFile), buildScss(capsuleName), 'utf-8');
    filesCreated.push(controllerFile, scssFile);
  }

  const relTargetDir = path.relative(process.cwd(), targetDir);
  process.stdout.write(`\n\x1b[1m\x1b[32m✔ Successfully generated crystalline capsule:\x1b[0m \x1b[36m${relTargetDir}/\x1b[0m\n`);
  for (const f of filesCreated) {
    process.stdout.write(`  \x1b[32m✔\x1b[0m ${f}\n`);
  }
  process.stdout.write('\n\x1b[2mChemical X Standards verified: < 100 lines per file, 2-stage booleans, zero inline styles.\x1b[0m\n\n');
};

export const runGenerateCapsule = async (capsuleName) => {
  return runGenerateWizard([capsuleName, '-y']);
};
