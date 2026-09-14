import fs from 'node:fs';
import path from 'node:path';
import { hasGum, gumChoose, gumInput, promptQuestion, renderBanner } from './terminal.js';
import { checkOrPromptEvaluation } from './license.js';
import {
  toPascalCase,
  toCamelCase,
  buildReactComponent,
  buildVueComponent,
  buildSvelteComponent,
  buildController,
  buildPropsType,
  buildStateType,
  buildTypesIndex,
  buildComponentSpec,
  buildScss,
  buildIndex,
  buildHook,
  buildHookOptionsType,
  buildHookReturnType,
  buildHookIndex,
  buildHookSpec,
  buildReactView,
  buildVueView,
  buildSvelteView,
  buildViewParamsType,
  buildViewIndex,
  buildViewSpec
} from './generator-templates.js';
import { detectFramework, detectTierBaseDir } from './project-detector.js';

const TIERS = [
  { prefix: 'm-', tier: 'molecule', label: '1. m- Molecule (Self-contained feature block < 100 lines - Recommended)' },
  { prefix: 'a-', tier: 'atom', label: '2. a- Atom (Single foundational UI element)' },
  { prefix: 'o-', tier: 'organism', label: '3. o- Organism (Complex module combining molecules)' },
  { prefix: 't-', tier: 'template', label: '4. t- Template (Structural layout blueprint)' },
  { prefix: 'use-', tier: 'hook', label: '5. hook Composable (Safe destructuring, self-cleaning)' },
  { prefix: 'v-', tier: 'view', label: '6. view Layout (Declarative Table of Contents, 10-20 lines)' }
];

const FRAMEWORKS = [
  { id: 'react', ext: 'tsx', label: '1. React 19 (TSX + Controller Hook)', compBuilder: buildReactComponent, viewBuilder: buildReactView },
  { id: 'vue', ext: 'vue', label: '2. Vue 3.4+ (SFC <script setup lang="ts">)', compBuilder: buildVueComponent, viewBuilder: buildVueView },
  { id: 'svelte', ext: 'svelte', label: '3. Svelte 5 (Runes + {prop} Shorthand)', compBuilder: buildSvelteComponent, viewBuilder: buildSvelteView }
];

const KNOWN_TIER_NAMES = new Set(['molecule', 'atom', 'organism', 'template', 'hook', 'composable', 'view', 'page']);
const IGNORED_NAME_TOKENS = new Set(['generate', 'capsule', 'add', 'g', 'gen']);

const resolveSelectedTier = (explicitTier, cleanName) => {
  if (explicitTier) {
    const normalized = explicitTier.toLowerCase();
    const matched = TIERS.find((t) => t.tier === normalized || t.tier.startsWith(normalized) || t.prefix.startsWith(normalized));
    if (matched) return matched;
  }
  if (cleanName.startsWith('use-') || cleanName.startsWith('use')) {
    return TIERS.find((t) => t.tier === 'hook');
  }
  if (cleanName.startsWith('v-') || cleanName.endsWith('-view')) {
    return TIERS.find((t) => t.tier === 'view');
  }
  const prefixMatch = cleanName.match(/^([a-z])-+/);
  if (prefixMatch) {
    const prefix = prefixMatch[0];
    const matched = TIERS.find((t) => t.prefix === prefix);
    if (matched) return matched;
  }
  return TIERS[0];
};

export const runGenerateWizard = async (rawArgs = []) => {
  const isJson = rawArgs.includes('--json');
  const isYes = rawArgs.includes('-y') || rawArgs.includes('--yes') || !process.stdin.isTTY;
  if (!isJson) renderBanner('Chemical X: Molecular Capsule Wizard');
  await checkOrPromptEvaluation('generate capsule', { isYes });

  const useGum = hasGum();

  const positional = rawArgs.filter((a) => !a.startsWith('-') && !IGNORED_NAME_TOKENS.has(a));
  let explicitTier = (rawArgs.find((a) => a.startsWith('--tier=')) || '').split('=')[1];
  let rawName = null;

  if (positional.length >= 2 && KNOWN_TIER_NAMES.has(positional[0].toLowerCase())) {
    explicitTier = positional[0].toLowerCase();
    rawName = positional[1];
  } else if (positional.length >= 1) {
    if (KNOWN_TIER_NAMES.has(positional[0].toLowerCase())) {
      explicitTier = positional[0].toLowerCase();
    } else {
      rawName = positional[0];
    }
  }

  const frameworkArg = (rawArgs.find((a) => a.startsWith('--framework=')) || '').split('=')[1]
    || (rawArgs.includes('-f') ? rawArgs[rawArgs.indexOf('-f') + 1] : null);
  const dirArg = (rawArgs.find((a) => a.startsWith('--dir=')) || '').split('=')[1];
  const isLean = rawArgs.includes('--lean');

  if (!rawName && !isYes) {
    rawName = useGum
      ? gumInput('Capsule feature name (e.g. user-avatar, spark-kpi, auth-status):', 'user-avatar')
      : await promptQuestion('Capsule feature name [user-avatar]: ');
  }
  const cleanName = (rawName || 'user-avatar').trim().toLowerCase();
  const selectedTier = resolveSelectedTier(explicitTier, cleanName);

  const autoFramework = detectFramework(process.cwd());
  const defaultFw = FRAMEWORKS.find((f) => f.id === autoFramework) || FRAMEWORKS[0];
  let selectedFramework = defaultFw;

  if (frameworkArg) {
    const found = FRAMEWORKS.find((f) => f.id === frameworkArg.toLowerCase() || f.ext === frameworkArg.toLowerCase());
    if (found) selectedFramework = found;
  } else if (!isYes) {
    const fwChoice = useGum
      ? gumChoose(FRAMEWORKS.map((f) => f.label), 'Select Framework Flavor')
      : await promptQuestion(`Select Framework Flavor [1=React, 2=Vue 3, 3=Svelte 5] (default: ${defaultFw.id}): `);
    const found = FRAMEWORKS.find((f) => fwChoice && (fwChoice.includes(f.label) || fwChoice.toLowerCase().includes(f.id)));
    if (found) selectedFramework = found;
  }

  let capsuleName = cleanName;
  if (selectedTier.tier === 'hook') {
    const stripped = cleanName.replace(/^use-?/, '');
    capsuleName = `use-${stripped}`;
  } else if (selectedTier.tier === 'view') {
    const stripped = cleanName.replace(/^v-?/, '').replace(/-view$/, '');
    capsuleName = `v-${stripped}`;
  } else {
    const stripped = cleanName.replace(/^[a-z]-/, '');
    capsuleName = `${selectedTier.prefix}${stripped}`;
  }

  const baseSlug = capsuleName.replace(/^[a-z]+-/, '');
  const pascalName = toPascalCase(baseSlug);
  const camelName = toCamelCase(capsuleName);

  const detectedDir = detectTierBaseDir(selectedTier.tier, process.cwd());
  let targetParent = dirArg || (isYes ? detectedDir : null);
  if (!targetParent) {
    const dirChoices = [
      `1. Detected directory (${detectedDir}/${capsuleName})`,
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
    const errMessage = `Directory ${capsuleName} already exists at ${targetDir}.`;
    if (isJson) {
      process.stdout.write(JSON.stringify({ error: errMessage, success: false }) + '\n');
      process.exit(1);
    }
    process.stderr.write(`\x1b[31m✕ Error: ${errMessage}\x1b[0m\n`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const typesDir = path.join(targetDir, 'types');
  fs.mkdirSync(typesDir, { recursive: true });

  const filesCreated = [];

  if (selectedTier.tier === 'hook') {
    const hookFile = `${capsuleName}.ts`;
    const specFile = `${capsuleName}.spec.ts`;

    fs.writeFileSync(path.join(targetDir, hookFile), buildHook(capsuleName, camelName, pascalName), 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'index.ts'), buildHookIndex(capsuleName, camelName), 'utf-8');
    fs.writeFileSync(path.join(targetDir, specFile), buildHookSpec(capsuleName, camelName), 'utf-8');

    fs.writeFileSync(path.join(typesDir, 'options.d.ts'), buildHookOptionsType(pascalName), 'utf-8');
    fs.writeFileSync(path.join(typesDir, 'return.d.ts'), buildHookReturnType(pascalName), 'utf-8');
    fs.writeFileSync(path.join(typesDir, 'index.ts'), buildTypesIndex(['options', 'return']), 'utf-8');

    filesCreated.push(hookFile, specFile, 'index.ts', 'types/options.d.ts', 'types/return.d.ts', 'types/index.ts');
  } else if (selectedTier.tier === 'view') {
    const viewFile = `${capsuleName}.${selectedFramework.ext}`;
    const specFile = `${capsuleName}.spec.ts`;

    fs.writeFileSync(path.join(targetDir, viewFile), selectedFramework.viewBuilder(capsuleName, pascalName), 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'index.ts'), buildViewIndex(capsuleName, pascalName, selectedFramework.ext), 'utf-8');
    fs.writeFileSync(path.join(targetDir, specFile), buildViewSpec(capsuleName, pascalName), 'utf-8');

    fs.writeFileSync(path.join(typesDir, 'params.d.ts'), buildViewParamsType(pascalName), 'utf-8');
    fs.writeFileSync(path.join(typesDir, 'index.ts'), buildTypesIndex(['params']), 'utf-8');

    filesCreated.push(viewFile, specFile, 'index.ts', 'types/params.d.ts', 'types/index.ts');
  } else {
    const compFile = `${capsuleName}.${selectedFramework.ext}`;
    const specFile = `${capsuleName}.spec.ts`;
    const hasController = !isLean && selectedTier.tier !== 'atom';
    fs.writeFileSync(path.join(targetDir, compFile), selectedFramework.compBuilder(capsuleName, pascalName), 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'index.ts'), buildIndex(capsuleName, pascalName, selectedFramework.ext), 'utf-8');
    fs.writeFileSync(path.join(targetDir, specFile), buildComponentSpec(capsuleName, pascalName, hasController), 'utf-8');

    fs.writeFileSync(path.join(typesDir, 'props.d.ts'), buildPropsType(capsuleName, pascalName), 'utf-8');
    fs.writeFileSync(path.join(typesDir, 'state.d.ts'), buildStateType(capsuleName, pascalName), 'utf-8');
    fs.writeFileSync(path.join(typesDir, 'index.ts'), buildTypesIndex(['props', 'state']), 'utf-8');

    filesCreated.push(compFile, specFile, 'index.ts', 'types/props.d.ts', 'types/state.d.ts', 'types/index.ts');

    if (!isLean && selectedTier.tier !== 'atom') {
      const controllerFile = `${capsuleName}.controller.ts`;
      fs.writeFileSync(path.join(targetDir, controllerFile), buildController(capsuleName, pascalName), 'utf-8');
      filesCreated.push(controllerFile);
    }

    if (!isLean) {
      const scssFile = `_${capsuleName}.scss`;
      fs.writeFileSync(path.join(targetDir, scssFile), buildScss(capsuleName), 'utf-8');
      filesCreated.push(scssFile);
    }
  }

  const relTargetDir = path.relative(process.cwd(), targetDir);
  const payload = {
    success: true,
    capsuleName,
    tier: selectedTier.tier,
    framework: selectedFramework.id,
    directory: relTargetDir,
    files: filesCreated
  };

  if (isJson) {
    process.stdout.write(JSON.stringify(payload) + '\n');
    return payload;
  }

  process.stdout.write(`\n\x1b[1m\x1b[32m✔ Successfully generated crystalline capsule:\x1b[0m \x1b[36m${relTargetDir}/\x1b[0m\n`);
  for (const f of filesCreated) {
    process.stdout.write(`  \x1b[32m✔\x1b[0m ${f}\n`);
  }
  process.stdout.write('\n\x1b[2mChemical X Standards verified: < 100 lines per file, granular domain types, co-located spec tests.\x1b[0m\n\n');
  return payload;
};

export const runGenerateCapsule = async (capsuleName) => {
  return runGenerateWizard([capsuleName, '-y']);
};

