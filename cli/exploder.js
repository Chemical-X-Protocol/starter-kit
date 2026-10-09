/**
 * Chemical X Capsule Exploder
 * Unpacks a single-file compact capsule into a directory capsule, losslessly or not at all:
 * the source is partitioned statement by statement (explode-plan.js), every generated file must
 * parse, every original statement and declaration must reappear, and only then is the batch
 * committed through applyEdits (atomic writes, original kept in .chemx/backups).
 */

import fs from 'node:fs';
import path from 'node:path';
import { toPascalCase } from './generator-templates/naming.js';
import { buildComponentSpec } from './generator-templates/specs.js';
import { buildTypesIndex } from './generator-templates/types.js';
import { detectTestRunner } from './project-detector.js';
import { resolveSafePath } from './path-scope.js';
import { applyEdits } from './apply-edits.js';
import { parseSource } from './source-parse.js';
import { planExplode, importHeader, relocated } from './explode-plan.js';
import { brokenSpecifiers } from './explode-relocate.js';
import { hasPreviewFlag, findUnknownFlags, unknownFlagsMessage } from './cli-args.js';

const joinSegments = (bucket, sub = '') => bucket.map((s) => relocated(s, sub).segment).join('\n').replace(/^\n+/, '');

/**
 * Compatibility view of the plan (sections as text).
 */
export const parseCompactFile = (content, ext = 'tsx') => {
  const plan = planExplode(content, `capsule.${ext}`);
  const reactImports = plan.statements
    .filter((s) => s.isImport && s.node.source.value === 'react')
    .flatMap((s) => s.node.specifiers.map((sp) => sp.imported?.name).filter(Boolean));
  return {
    typesProps: joinSegments(plan.buckets.props),
    typesState: joinSegments(plan.buckets.state),
    controllerHookCode: plan.buckets.controller.length ? joinSegments(plan.buckets.controller) : null,
    componentCode: joinSegments(plan.buckets.component.filter((s) => !s.isImport)) || null,
    reactImports
  };
};

const buildCapsuleFiles = (plan, names) => {
  const { capsuleName, pascalName, ext } = names;
  const typesSub = `${capsuleName}/types`;
  const isReact = ext === 'tsx' || ext === 'jsx';
  const typeHomeFor = (fileKey) => (id) => {
    const isProps = plan.buckets.props.some((s) => s.typeName === id);
    const home = isProps ? 'props' : 'state';
    const isTypesFile = fileKey === 'types';
    if (isTypesFile) return null;
    const isSameFile = fileKey === home;
    return isSameFile ? null : './types';
  };
  const typesFile = (bucket, key, stub) => {
    const other = key === 'props' ? 'state' : 'props';
    const header = importHeader(bucket, plan, (id) => (plan.buckets[other].some((s) => s.typeName === id) ? `./${other}` : null), typesSub);
    return bucket.length ? `${header}${joinSegments(bucket, typesSub)}\n` : stub;
  };

  const files = {
    'types/props.d.ts': typesFile(plan.buckets.props, 'props', `export interface ${pascalName}Props {\n  readonly className?: string;\n}\n`),
    'types/state.d.ts': typesFile(plan.buckets.state, 'state', `export interface ${pascalName}State {\n  readonly isActive: boolean;\n}\n`),
    'types/index.ts': buildTypesIndex(['props', 'state']),
    'types.d.ts': "export * from './types/index';\n"
  };

  const controllerName = plan.controllerName || (isReact ? `use${pascalName}Controller` : null);
  if (plan.controllerName) {
    files[`${capsuleName}.controller.ts`] = `${importHeader(plan.buckets.controller, plan, typeHomeFor('controller'), capsuleName)}${joinSegments(plan.buckets.controller, capsuleName)}\n`;
  } else if (isReact) {
    files[`${capsuleName}.controller.ts`] = `import { useState } from 'react';\n\nexport const ${controllerName} = () => {\n  const [isActive] = useState<boolean>(false);\n  return { isActive };\n};\n`;
  }

  const body = plan.buckets.component;
  const usesController = Boolean(plan.controllerName) && body.some((s) => s.text.includes(plan.controllerName));
  const controllerImport = usesController ? `import { ${plan.controllerName} } from './${capsuleName}.controller';\n` : '';
  const hasBody = body.some((s) => !s.isImport);
  const stubBody = isReact ? `export const ${pascalName} = ({ className = '' }: ${pascalName}Props) => {\n  return <div className={className} />;\n};\n` : '';
  const header = importHeader(body, plan, typeHomeFor('component'), capsuleName);
  files[`${capsuleName}.${ext}`] = hasBody
    ? `${controllerImport}${header}${joinSegments(body, capsuleName)}\n`
    : `import type { ${pascalName}Props } from './types';\n${stubBody}`;
  return { files, controllerName };
};

const isDefaultSpecifier = (sp) => (sp.exported?.name ?? sp.exported?.value) === 'default';
const isDefaultExport = (n) => n.type === 'ExportDefaultDeclaration' || (n.type === 'ExportNamedDeclaration' && (n.specifiers || []).some(isDefaultSpecifier));
const isNamedExport = (n) => n.type === 'ExportAllDeclaration' || n.type === 'ExportNamedDeclaration';

/**
 * The barrel re-exports everything the original module exported, the default export included,
 * so `import X from './card'` and `import { Y } from './card'` keep resolving.
 */
const buildIndexFile = (files, names, controllerName) => {
  const compFile = `${names.capsuleName}.${names.ext}`;
  const body = parseSource(files[compFile], compFile).programs.flatMap((p) => p.body);
  const lines = [];
  const hasNamedExports = body.some(isNamedExport);
  const hasDefaultExport = body.some(isDefaultExport);
  if (hasNamedExports) lines.push(`export * from './${names.capsuleName}';`);
  if (hasDefaultExport) lines.push(`export { default } from './${names.capsuleName}';`);
  const hasControllerFile = Boolean(controllerName) && Boolean(files[`${names.capsuleName}.controller.ts`]);
  if (hasControllerFile) lines.push(`export { ${controllerName} } from './${names.capsuleName}.controller';`);
  lines.push("export type * from './types';");
  return `${lines.join('\n')}\n`;
};

const verifyLossless = (plan, files, names) => {
  const typesSub = `${names.capsuleName}/types`;
  const subFor = { props: typesSub, state: typesSub, controller: names.capsuleName, component: names.capsuleName };
  const lost = Object.entries(plan.buckets).flatMap(([bucket, list]) => {
    const target = files[bucketFile(bucket, names)] || '';
    return list.filter((s) => !target.includes(relocated(s, subFor[bucket]).text)).map((s) => s.names[0] || s.text.split('\n')[0]);
  });
  const parsed = Object.entries(files).map(([name, text]) => [name, parseSource(text, name)]);
  const unparsed = parsed.filter(([, res]) => !res.ok).map(([name, res]) => `${name}: ${res.error}`);
  const declared = new Set(parsed.flatMap(([, res]) => res.declarations));
  const missing = plan.declarations.filter((name) => !declared.has(name));
  const programsByFile = Object.fromEntries(parsed.map(([name, res]) => [`${names.capsuleName}/${name}`, res.programs]));
  const originalSpecifiers = plan.statements.flatMap((s) => s.relSpecs.map((r) => r.value));
  const broken = brokenSpecifiers(programsByFile, originalSpecifiers);
  const problems = [
    ...lost.map((l) => `statement not carried over: ${l}`),
    ...unparsed.map((u) => `generated file does not parse: ${u}`),
    ...missing.map((m) => `declaration missing: ${m}`),
    ...broken.map((b) => `relative import would no longer resolve: ${b}`)
  ];
  const isLossy = problems.length > 0;
  if (isLossy) throw new Error(`Explode refused (would lose or break code): ${problems.join('; ')}. Nothing was changed.`);
};

export const explodeCapsule = (targetFilePath, options = {}) => {
  const cwd = options.cwd || process.cwd();
  const absPath = resolveSafePath(targetFilePath, cwd);
  const isMissing = !fs.existsSync(absPath);
  if (isMissing) throw new Error(`Target file not found at ${absPath}`);
  const isDirectory = fs.statSync(absPath).isDirectory();
  if (isDirectory) throw new Error(`Target ${targetFilePath} is already a directory capsule.`);

  const ext = path.extname(absPath).replace('.', '');
  const isSfc = ext === 'vue' || ext === 'svelte';
  if (isSfc) throw new Error(`Explode refused: .${ext} files are not supported until SFC parsing lands (plan B). Nothing was changed.`);

  const capsuleName = path.basename(absPath).replace(/\.[^.]+$/, '');
  const targetDir = path.join(path.dirname(absPath), capsuleName);
  const isTaken = fs.existsSync(targetDir);
  if (isTaken) throw new Error(`Destination directory ${capsuleName} already exists.`);

  const content = fs.readFileSync(absPath, 'utf-8');
  const names = { capsuleName, pascalName: toPascalCase(capsuleName.replace(/^[a-z]+-/, '')), ext };
  let plan;
  try {
    plan = planExplode(content, absPath);
  } catch (err) {
    throw new Error(`Explode refused: the source does not parse (${err.message}). Nothing was changed.`);
  }
  const { files, controllerName } = buildCapsuleFiles(plan, names);
  files['index.ts'] = buildIndexFile(files, names, controllerName);
  const specController = controllerName === `use${names.pascalName}Controller` && Boolean(files[`${capsuleName}.controller.ts`]);
  files[`${capsuleName}.spec.ts`] = buildComponentSpec(capsuleName, names.pascalName, specController, detectTestRunner(path.dirname(absPath)));
  verifyLossless(plan, files, names);

  const edits = [
    ...Object.entries(files).map(([rel, text]) => ({ path: path.join(targetDir, rel), content: text })),
    { path: absPath, delete: true }
  ];
  const applied = applyEdits(edits, { cwd, dryRun: Boolean(options.dryRun), agentId: options.agentId });
  const placement = Object.fromEntries(Object.entries(plan.buckets).flatMap(([bucket, list]) => list.flatMap((s) => s.names.map((n) => [n, bucketFile(bucket, names)]))));
  const original = applied.files.find((f) => f.deleted);
  return {
    success: true,
    ...(options.dryRun ? { dryRun: true, diff: applied.diff } : {}),
    capsuleName,
    targetDir: path.relative(fs.realpathSync(cwd), targetDir),
    files: Object.keys(files),
    placement,
    backup: original?.backup || null
  };
};

const bucketFile = (bucket, names) => ({
  props: 'types/props.d.ts',
  state: 'types/state.d.ts',
  controller: `${names.capsuleName}.controller.ts`,
  component: `${names.capsuleName}.${names.ext}`
}[bucket]);

export const runExplodeCli = async (rawArgs = [], isCli = true) => {
  const isJson = rawArgs.includes('--json');
  const isDryRun = hasPreviewFlag(rawArgs);
  const target = rawArgs.find((a) => !a.startsWith('-'));
  const unknown = findUnknownFlags(rawArgs, []);
  const hasUnknownFlags = unknown.length > 0;
  const hasTarget = Boolean(target);

  if (hasUnknownFlags || !hasTarget) {
    const msg = hasUnknownFlags ? unknownFlagsMessage('explode', unknown) : 'Usage: npx chemx explode <file-path> [--dry-run] [--json]';
    if (isJson) {
      process.stdout.write(JSON.stringify({ error: msg, success: false }) + '\n');
    } else {
      process.stderr.write(`\x1b[31m✕ Error: ${msg}\x1b[0m\n`);
    }
    if (isCli) process.exit(1);
    if (hasUnknownFlags) throw new Error(msg);
    return { error: msg, success: false };
  }

  try {
    const result = explodeCapsule(target, { dryRun: isDryRun });
    if (isJson) {
      process.stdout.write(JSON.stringify(result) + '\n');
    } else {
      const verb = result.dryRun ? '[DRY RUN] Would explode capsule' : '✔ Exploded capsule';
      process.stdout.write(`\n${verb}: ${result.targetDir}/\n`);
      for (const [name, file] of Object.entries(result.placement)) {
        process.stdout.write(`  ${name} -> ${file}\n`);
      }
      if (result.backup) process.stdout.write(`  original kept at ${result.backup}\n`);
      if (result.dryRun) process.stdout.write(`\n${result.diff}\n`);
      process.stdout.write('\n');
    }
    if (isCli) process.exit(0);
    return result;
  } catch (err) {
    if (isJson) {
      process.stdout.write(JSON.stringify({ error: err.message, success: false }) + '\n');
    } else {
      process.stderr.write(`\x1b[31m✕ Error: ${err.message}\x1b[0m\n`);
    }
    if (isCli) process.exit(1);
    throw err;
  }
};
