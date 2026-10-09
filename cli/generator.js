import fs from 'node:fs';
import path from 'node:path';
import { hasGum, gumChoose, gumInput, promptQuestion, isStdinTty, isStderrTty } from './terminal.js';
import { renderTtyBanner } from './tty-banner.js';
import { describeLineBudgetPolicy } from './config/profiles.js';
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
import { detectFramework, resolveFramework, detectTierBaseDir, detectInstalledFamily, detectTestRunner, detectStylingStack } from './project-detector.js';
import { indexGeneratedFiles } from './generator-indexer.js';
import { printGenerateHelp } from './generator-help.js';
import { createJigFiles, JIG_KINDS } from './generator-jig.js';
import { handleJigCli } from './generator-jig-cli.js';
import { hasPreviewFlag, readFlagValue } from './cli-args.js';
import { createCompactCapsule } from './generator-compact.js';
import { writeGeneratedFiles } from './generator-writes.js';
export { printGenerateHelp } from './generator-help.js';
export { createJigFiles, JIG_KINDS } from './generator-jig.js';
export { handleJigCli } from './generator-jig-cli.js';

const TIERS = [
  { prefix: 'm-', tier: 'molecule', label: '1. m- Molecule (Self-contained feature block - Recommended)' },
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
const IGNORED_NAME_TOKENS = new Set(['generate', 'capsule', 'add', 'g', 'gen', 'jig']);
export const isCapsuleNameArg = (arg) => !arg.startsWith('-') && !IGNORED_NAME_TOKENS.has(arg);

const resolveSelectedTier = (explicitTier, cleanName) => {
  if (explicitTier) {
    const normalized = explicitTier.toLowerCase();
    const matched = TIERS.find((t) => t.tier === normalized || t.tier.startsWith(normalized) || t.prefix.startsWith(normalized));
    if (matched) return matched;
  }
  const isHookName = cleanName.startsWith('use');
  if (isHookName) {
    return TIERS.find((t) => t.tier === 'hook');
  }
  const isViewName = cleanName.startsWith('v-') || cleanName.endsWith('-view');
  if (isViewName) {
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

// Tier prefix rules: hooks are use-<x>, views v-<x>, everything else <tier prefix><x>.
const capsuleNameFor = (selectedTier, cleanName) => {
  const isHook = selectedTier.tier === 'hook';
  if (isHook) return `use-${cleanName.replace(/^use-?/, '')}`;
  const isView = selectedTier.tier === 'view';
  if (isView) return `v-${cleanName.replace(/^v-?/, '').replace(/-view$/, '')}`;
  return `${selectedTier.prefix}${cleanName.replace(/^[a-z]-/, '')}`;
};

export const detectBaseDir = (cwd = process.cwd()) => {
  return detectTierBaseDir('molecule', cwd);
};

export const createCapsuleFiles = ({
  name = 'user-avatar',
  framework = null,
  tier = 'm',
  targetParent = null,
  isLean = false,
  cwd = process.cwd(),
  desc = '',
  description = '',
  template = null,
  templateArg = null,
  css = null,
  compact = false,
  flat = false,
  dryRun = false,
  agentId = undefined
}) => {
  const capsuleDesc = desc || description || '';
  const cleanName = (name || 'user-avatar').trim().toLowerCase();
  const selectedTier = resolveSelectedTier(tier, cleanName);
  const explicitTemplate = template || templateArg || null;
  const isCompact = Boolean(compact || flat);
  const styling = detectStylingStack(cwd);
  const wantsNoScss = css === 'none' || css === 'tailwind' || (styling.hasTailwind && css !== 'scss');

  const resolvedFrameworkId = resolveFramework({ frameworkArg: framework, cwd });
  const selectedFramework = FRAMEWORKS.find(
    (f) => f.id === resolvedFrameworkId || f.ext === resolvedFrameworkId
  ) || FRAMEWORKS[0];

  const capsuleName = capsuleNameFor(selectedTier, cleanName);

  const baseSlug = capsuleName.replace(/^[a-z]+-/, '');
  const pascalName = toPascalCase(baseSlug);
  const camelName = toCamelCase(capsuleName);

  const detectedDir = detectTierBaseDir(selectedTier.tier, cwd);
  const parentDir = targetParent || detectedDir;
  const resolvedParent = path.resolve(cwd, parentDir || '.');

  const isHookOrView = selectedTier.tier === 'hook' || selectedTier.tier === 'view';
  const canUseCompact = isCompact && !isHookOrView;
  if (canUseCompact) {
    return createCompactCapsule({ capsuleName, pascalName, capsuleDesc, explicitTemplate, selectedFramework, selectedTier, resolvedParent, cwd, dryRun, agentId });
  }

  const targetDir = path.resolve(resolvedParent, capsuleName);
  const runner = detectTestRunner(targetDir || cwd);

  const isTaken = !dryRun && fs.existsSync(targetDir);
  if (isTaken) {
    throw new Error(`Directory ${capsuleName} already exists at ${targetDir}.`);
  }

  const typesDir = path.join(targetDir, 'types');
  const filesCreated = [];
  const previews = [];
  const pendingFiles = [];

  // Files are collected first and written together once every path clears the team-lock check.
  const recordFile = (relFile, absPath, content) => {
    filesCreated.push(relFile);
    previews.push({ file: relFile, lines: content.split('\n').length });
    pendingFiles.push({ absPath, content });
  };

  const isHookTier = selectedTier.tier === 'hook';
  const isViewTier = selectedTier.tier === 'view';
  if (isHookTier) {
    const hookFile = `${capsuleName}.ts`;
    const specFile = `${capsuleName}.spec.ts`;

    recordFile(hookFile, path.join(targetDir, hookFile), buildHook(capsuleName, camelName, pascalName));
    recordFile('index.ts', path.join(targetDir, 'index.ts'), buildHookIndex(capsuleName, camelName));
    recordFile(specFile, path.join(targetDir, specFile), buildHookSpec(capsuleName, camelName, runner));

    recordFile('types/options.d.ts', path.join(typesDir, 'options.d.ts'), buildHookOptionsType(pascalName));
    recordFile('types/return.d.ts', path.join(typesDir, 'return.d.ts'), buildHookReturnType(pascalName));
    recordFile('types/index.ts', path.join(typesDir, 'index.ts'), buildTypesIndex(['options', 'return']));
    recordFile('types.d.ts', path.join(targetDir, 'types.d.ts'), "export * from './types/index';\n");
  } else if (isViewTier) {
    const viewFile = `${capsuleName}.${selectedFramework.ext}`;
    const specFile = `${capsuleName}.spec.ts`;

    recordFile(viewFile, path.join(targetDir, viewFile), selectedFramework.viewBuilder(capsuleName, pascalName));
    recordFile('index.ts', path.join(targetDir, 'index.ts'), buildViewIndex(capsuleName, pascalName, selectedFramework.ext));
    recordFile(specFile, path.join(targetDir, specFile), buildViewSpec(capsuleName, pascalName, runner));

    recordFile('types/params.d.ts', path.join(typesDir, 'params.d.ts'), buildViewParamsType(pascalName));
    recordFile('types/index.ts', path.join(typesDir, 'index.ts'), buildTypesIndex(['params']));
    recordFile('types.d.ts', path.join(targetDir, 'types.d.ts'), "export * from './types/index';\n");
  } else {
    const compFile = `${capsuleName}.${selectedFramework.ext}`;
    const specFile = `${capsuleName}.spec.ts`;
    const hasController = !isLean && selectedTier.tier !== 'atom';
    const installedFamily = detectInstalledFamily(cwd);
    const templateOpts = {
      atomsPackage: installedFamily.atomsPackage,
      hasController,
      description: capsuleDesc,
      framework: selectedFramework.id,
      template: explicitTemplate
    };

    recordFile(compFile, path.join(targetDir, compFile), selectedFramework.compBuilder(capsuleName, pascalName, templateOpts));
    recordFile('index.ts', path.join(targetDir, 'index.ts'), buildIndex(capsuleName, pascalName, selectedFramework.ext, hasController));
    recordFile(specFile, path.join(targetDir, specFile), buildComponentSpec(capsuleName, pascalName, hasController, runner));

    const domainOpts = { description: capsuleDesc, framework: selectedFramework.id, template: explicitTemplate };
    recordFile('types/props.d.ts', path.join(typesDir, 'props.d.ts'), buildPropsType(capsuleName, pascalName, domainOpts));
    recordFile('types/state.d.ts', path.join(typesDir, 'state.d.ts'), buildStateType(capsuleName, pascalName, domainOpts));
    recordFile('types/index.ts', path.join(typesDir, 'index.ts'), buildTypesIndex(['props', 'state']));
    recordFile('types.d.ts', path.join(targetDir, 'types.d.ts'), "export * from './types/index';\n");

    if (hasController) {
      const controllerFile = `${capsuleName}.controller.ts`;
      recordFile(controllerFile, path.join(targetDir, controllerFile), buildController(capsuleName, pascalName, domainOpts));
    }

    const shouldWriteScss = !isLean && !wantsNoScss;
    if (shouldWriteScss) {
      const scssFile = `_${capsuleName}.scss`;
      recordFile(scssFile, path.join(targetDir, scssFile), buildScss(capsuleName));
    }
  }

  const isWrite = !dryRun;
  if (isWrite) {
    writeGeneratedFiles({ dirs: [targetDir, typesDir], files: pendingFiles, cwd, agentId });
    indexGeneratedFiles(cwd, targetDir, filesCreated);
  }

  const relTargetDir = path.relative(cwd, targetDir);

  return {
    success: true,
    dryRun: Boolean(dryRun),
    capsuleName,
    pascalName,
    framework: selectedFramework.id,
    tier: selectedTier.tier,
    targetDir,
    relativeDir: relTargetDir,
    directory: relTargetDir,
    files: filesCreated,
    filesCreated,
    previews
  };
};

export const runGenerateWizard = async (rawArgs = []) => {
  const isHelp = rawArgs.includes('--help') || rawArgs.includes('-h') || rawArgs.includes('help');
  if (isHelp) {
    const isJsonHelp = rawArgs.includes('--json');
    if (isJsonHelp) {
      process.stdout.write(JSON.stringify({ help: true, success: true }) + '\n');
    } else {
      await printGenerateHelp();
    }
    return { success: true, help: true };
  }

  const isJson = rawArgs.includes('--json');
  const isYes = rawArgs.includes('-y') || rawArgs.includes('--yes') || isJson || !isStdinTty();
  if (!isJson) await renderTtyBanner('Chemical X: Molecular Capsule Wizard');
  const licenseGate = await checkOrPromptEvaluation('generate capsule', { isYes });
  const isGateCancelled = Boolean(licenseGate.cancelled);
  if (isGateCancelled) return { success: false, cancelled: true };

  const useGum = hasGum();

  // --as=@handle or --as @handle: the identity team locks are checked against; its value is never a name.
  const asFlag = readFlagValue(rawArgs, ['--as']);
  const agentId = asFlag.value;
  const positional = rawArgs.filter((a, i) => !a.startsWith('-') && !IGNORED_NAME_TOKENS.has(a) && !asFlag.consumed.includes(i));
  let explicitTier = (rawArgs.find((a) => a.startsWith('--tier=')) || '').split('=')[1];
  let rawName = null;
  const isFirstTier = positional.length >= 1 && KNOWN_TIER_NAMES.has(positional[0].toLowerCase());
  const isTierThenName = isFirstTier && positional.length >= 2;
  const hasPositional = positional.length >= 1;

  if (isTierThenName) {
    explicitTier = positional[0].toLowerCase();
    rawName = positional[1];
  } else if (hasPositional) {
    if (isFirstTier) {
      explicitTier = positional[0].toLowerCase();
    } else {
      rawName = positional[0];
    }
  }

  const frameworkArg = (rawArgs.find((a) => a.startsWith('--framework=')) || '').split('=')[1]
    || (rawArgs.includes('-f') ? rawArgs[rawArgs.indexOf('-f') + 1] : null);
  const dirArg = (rawArgs.find((a) => a.startsWith('--dir=')) || '').split('=')[1];
  const isLean = rawArgs.includes('--lean');
  const descArg = (rawArgs.find((a) => a.startsWith('--desc=') || a.startsWith('--description=') || a.startsWith('--prompt=')) || '')
    .replace(/^--(desc|description|prompt)=/, '');
  const isDryRun = hasPreviewFlag(rawArgs);

  const isBareOrMinimal = rawArgs.includes('--bare') || rawArgs.includes('--minimal');
  const templateFlagMatch = (rawArgs.find((a) => a.startsWith('--template=')) || '').split('=')[1];
  const templateShorthands = [[isBareOrMinimal, 'minimal'], [rawArgs.includes('--controls'), 'controls'], [rawArgs.includes('--canvas'), 'canvas']];
  const templateArg = templateFlagMatch || templateShorthands.find(([isSet]) => isSet)?.[1] || null;

  const cssFlagMatch = (rawArgs.find((a) => a.startsWith('--css=')) || '').split('=')[1];
  const isNoScss = rawArgs.includes('--no-scss');
  const cssArg = cssFlagMatch || (isNoScss ? 'none' : null);

  const hasCompactFlag = rawArgs.includes('--compact');
  const hasFlatFlag = rawArgs.includes('--flat');
  const isCompact = hasCompactFlag || hasFlatFlag;

  const jigFlag = (rawArgs.find((a) => a.startsWith('--jig=')) || '').split('=')[1];
  const kindFlag = (rawArgs.find((a) => a.startsWith('--kind=')) || '').split('=')[1];
  const isJigWord = positional[0] && (JIG_KINDS.has(positional[0].toLowerCase()) || positional[0].toLowerCase() === 'jig');
  const isJig = Boolean(jigFlag || kindFlag || rawArgs.includes('--jig') || isJigWord);

  if (isJig) {
    return handleJigCli({ rawArgs, positional, rawName, dirArg, descArg, isDryRun, isJson });
  }

  const shouldPromptName = !rawName && !isYes;
  const isMissingNameUnattended = !rawName && isYes;
  if (shouldPromptName) {
    rawName = useGum
      ? gumInput('Capsule feature name (e.g. user-avatar, spark-kpi, auth-status):', 'user-avatar')
      : await promptQuestion('Capsule feature name [user-avatar]: ');
  } else if (isMissingNameUnattended) {
    // Non-interactive (piped, --json or -y): never invent a default capsule name.
    const message = 'Missing capsule name. Usage: chemx generate <name> [options]';
    if (isJson) {
      process.stdout.write(JSON.stringify({ error: message, success: false }) + '\n');
      process.exit(1);
    }
    const errorLine = `✕ Error: ${message}`;
    process.stderr.write(isStderrTty() ? `\x1b[31m${errorLine}\x1b[0m\n` : `${errorLine}\n`);
    process.exit(1);
  }
  const cleanName = (rawName || 'user-avatar').trim().toLowerCase();
  const selectedTier = resolveSelectedTier(explicitTier, cleanName);

  const targetCwd = dirArg ? path.resolve(process.cwd(), dirArg) : process.cwd();
  const resolvedFrameworkId = resolveFramework({ frameworkArg, cwd: targetCwd });
  const defaultFw = FRAMEWORKS.find((f) => f.id === resolvedFrameworkId || f.ext === resolvedFrameworkId) || FRAMEWORKS[0];
  let selectedFramework = defaultFw;

  const shouldPromptFramework = !frameworkArg && !isYes;
  if (shouldPromptFramework) {
    const fwChoice = useGum
      ? gumChoose(FRAMEWORKS.map((f) => f.label), 'Select Framework Flavor')
      : await promptQuestion(`Select Framework Flavor [1=React, 2=Vue 3, 3=Svelte 5] (default: ${defaultFw.id}): `);
    const found = FRAMEWORKS.find((f) => fwChoice && (fwChoice.includes(f.label) || fwChoice.toLowerCase().includes(f.id)));
    if (found) selectedFramework = found;
  }

  const capsuleName = capsuleNameFor(selectedTier, cleanName);

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

    const pick = dirPick || '';
    const isCurrentDir = pick.startsWith('2.');
    const isCustomDir = pick.startsWith('3.');
    if (isCurrentDir) {
      targetParent = '.';
    } else if (isCustomDir) {
      targetParent = useGum
        ? gumInput('Enter custom parent directory path:', detectedDir)
        : await promptQuestion(`Enter custom parent directory path [${detectedDir}]: `);
    } else {
      targetParent = detectedDir;
    }
  }

  let result;
  try {
    result = createCapsuleFiles({
      name: cleanName,
      framework: selectedFramework.id,
      tier: selectedTier.tier,
      targetParent,
      isLean,
      cwd: targetCwd,
      desc: descArg,
      template: templateArg,
      css: cssArg,
      compact: isCompact,
      dryRun: isDryRun,
      agentId
    });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    if (isJson) {
      process.stdout.write(JSON.stringify({ error: errMessage, success: false }) + '\n');
      process.exit(1);
    }
    process.stderr.write(`\x1b[31m✕ Error: ${errMessage}\x1b[0m\n`);
    process.exit(1);
  }

  if (isJson) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return result;
  }

  const isDryRunResult = Boolean(result.dryRun);
  if (isDryRunResult) {
    process.stdout.write(`\n\x1b[1m\x1b[33m[DRY RUN]\x1b[0m Would generate crystalline capsule at \x1b[36m${result.relativeDir}/\x1b[0m:\n`);
    for (const f of result.previews || []) {
      process.stdout.write(`  \x1b[33m•\x1b[0m ${f.file} (${f.lines} lines)\n`);
    }
    process.stdout.write('\n\x1b[2mDry run complete. No files or directories were written to disk.\x1b[0m\n\n');
    return result;
  }

  process.stdout.write(`\n\x1b[1m\x1b[32m✔ Successfully generated crystalline capsule:\x1b[0m \x1b[36m${result.relativeDir}/\x1b[0m\n`);
  for (const f of result.filesCreated) {
    process.stdout.write(`  \x1b[32m✔\x1b[0m ${f}\n`);
  }
  process.stdout.write(`\n\x1b[2mCapsule written with granular domain types and co-located spec tests. ${describeLineBudgetPolicy()}\x1b[0m\n\n`);
  return result;
};

export const runGenerateCapsule = async (capsuleName) => {
  return runGenerateWizard([capsuleName, '-y']);
};
