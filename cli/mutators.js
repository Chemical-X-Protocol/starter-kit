import fs from 'node:fs';
import path from 'node:path';
import { toPascalCase } from './generator-templates.js';
import { ANSI } from './theme.js';
import { runAutofix } from './audit/autofix.js';
import { applyEdits } from './apply-edits.js';

const relToCwd = (absPath) => path.relative(process.cwd(), absPath);

/**
 * Commits computed capsule edits through applyEdits and lists only files that really changed.
 */
const commitCapsuleEdits = (edits, opts) => {
  const applied = applyEdits(edits, { cwd: opts.cwd || process.cwd(), dryRun: opts.isDryRun, agentId: opts.agentId });
  return {
    updatedFiles: applied.files.filter((f) => f.changed).map((f) => relToCwd(f.absPath)),
    diff: applied.diff
  };
};

export const resolveCapsuleFiles = (targetPath, cwd = process.cwd()) => {
  const abs = path.resolve(cwd, targetPath);
  const stat = fs.existsSync(abs) ? fs.statSync(abs) : null;
  const dir = stat && stat.isDirectory() ? abs : path.dirname(abs);

  const granularProps = path.join(dir, 'types', 'props.d.ts');
  const granularState = path.join(dir, 'types', 'state.d.ts');
  const flatTypes = path.join(dir, 'types.d.ts');

  const resolveTypesFile = (granularPath, flatPath) => {
    if (fs.existsSync(granularPath)) return granularPath;
    if (fs.existsSync(flatPath)) return flatPath;
    return null;
  };

  const typesPropsFile = resolveTypesFile(granularProps, flatTypes);
  const typesStateFile = resolveTypesFile(granularState, flatTypes);

  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const compFile = files.find((f) => f.endsWith('.tsx') || f.endsWith('.vue') || f.endsWith('.svelte'));
  const compPath = compFile ? path.join(dir, compFile) : null;
  const compExt = compFile ? path.extname(compFile).slice(1) : null;

  const controllerFile = files.find((f) => f.endsWith('.controller.ts'));
  const controllerPath = controllerFile ? path.join(dir, controllerFile) : null;

  return {
    dir,
    typesPropsFile,
    typesStateFile,
    compPath,
    compExt,
    controllerPath
  };
};

export const addPropToCapsule = (targetPath, propDefinition, options = {}) => {
  let propName;
  let propType;
  let isOptional = true;

  if (typeof propDefinition === 'string' && propDefinition.includes(':')) {
    const [rawName, ...typeParts] = propDefinition.split(':');
    propName = rawName.trim().replace(/[\?!]$/, '');
    propType = typeParts.join(':').trim() || 'string';
    isOptional = !rawName.endsWith('!') && options.optional !== false;
  } else if (typeof propDefinition === 'string') {
    propName = propDefinition.trim().replace(/[\?!]$/, '');
    propType = typeof options === 'string' ? options : (options.type || 'string');
    isOptional = !propDefinition.endsWith('!') && options.optional !== false;
  } else {
    throw new Error('Invalid prop definition. Expected format: <propName>:<propType> (e.g. avatarUrl:string)');
  }

  const opts = typeof options === 'object' ? options : {};
  const isDryRun = Boolean(opts.dryRun || opts['dry-run']);
  const files = resolveCapsuleFiles(targetPath, opts.cwd || process.cwd());
  const updatedFiles = [];
  const edits = [];

  const hasTarget = Boolean(files.typesPropsFile) && fs.existsSync(files.typesPropsFile);
  if (!hasTarget) {
    throw new Error(`No props type file found in capsule at ${targetPath}.`);
  }

  let typesContent = fs.readFileSync(files.typesPropsFile, 'utf-8');
  const isValidName = /^[A-Za-z_$][\w$]*$/.test(propName);
  if (!isValidName) throw new Error(`Invalid prop name "${propName}".`);
  const regexExists = new RegExp(`\\b${propName.replace(/\$/g, '\\$')}\\??\\s*:`);
  if (regexExists.test(typesContent)) {
    return { success: true, alreadyExists: true, propName, propType, updatedFiles };
  }

  const propDeclaration = `  readonly ${propName}${isOptional ? '?' : ''}: ${propType};\n`;
  const propsBlock = /((?:interface\s+\w+Props|type\s+\w+Props\s*=)\s*\{[\s\S]*?)(\n\s*\})/;
  const hasPropsBlock = propsBlock.test(typesContent);
  if (!hasPropsBlock) {
    throw new Error(`No "interface <Name>Props {" or "type <Name>Props = {" block found in ${relToCwd(files.typesPropsFile)}; nothing was changed.`);
  }
  typesContent = typesContent.replace(propsBlock, (_m, head, tail) => `${head}\n${propDeclaration}${tail}`);
  edits.push({ path: files.typesPropsFile, content: typesContent });

  if (files.compPath && fs.existsSync(files.compPath)) {
    let compContent = fs.readFileSync(files.compPath, 'utf-8');
    let compModified = false;

    if (files.compExt === 'tsx' && !compContent.includes(propName)) {
      const fcMatch = compContent.match(/(\(\{\s*\n\s*)([a-zA-Z0-9_]+)/);
      if (fcMatch) {
        compContent = compContent.replace(fcMatch[0], () => `${fcMatch[1]}${propName},\n  ${fcMatch[2]}`);
        compModified = true;
      }
    } else if (files.compExt === 'svelte' && !compContent.includes(propName)) {
      const svelteMatch = compContent.match(/(const\s*\{\s*\n\s*)([a-zA-Z0-9_]+)/);
      if (svelteMatch) {
        compContent = compContent.replace(svelteMatch[0], () => `${svelteMatch[1]}${propName},\n  ${svelteMatch[2]}`);
        compModified = true;
      }
    }

    if (compModified) edits.push({ path: files.compPath, content: compContent });
  }

  const committed = commitCapsuleEdits(edits, { ...opts, isDryRun });
  updatedFiles.push(...committed.updatedFiles);
  return { success: true, dryRun: isDryRun, propName, propType, updatedFiles, diff: committed.diff };
};

export const addStateToCapsule = (targetPath, statusName, payload = '', options = {}) => {
  const cleanStatus = statusName.trim().toLowerCase();
  const opts = typeof options === 'object' ? options : {};
  const isDryRun = Boolean(opts.dryRun || opts['dry-run']);
  const files = resolveCapsuleFiles(targetPath, opts.cwd || process.cwd());
  const updatedFiles = [];

  const hasTarget = Boolean(files.typesStateFile) && fs.existsSync(files.typesStateFile);
  if (!hasTarget) {
    throw new Error(`No state type file found in capsule at ${targetPath}.`);
  }

  let stateContent = fs.readFileSync(files.typesStateFile, 'utf-8');
  if (stateContent.includes(`status: '${cleanStatus}'`)) {
    return { success: true, alreadyExists: true, statusName: cleanStatus, updatedFiles };
  }

  const cleanPayload = (typeof payload === 'string' ? payload : '').trim();
  const resolvePayloadString = (p) => {
    if (!p) return '';
    if (p.startsWith('readonly')) return `; ${p}`;
    return `; readonly ${p}`;
  };
  const payloadStr = resolvePayloadString(cleanPayload);
  const newMember = `  | { readonly status: '${cleanStatus}'${payloadStr} }`;

  const stateUnion = /(export\s+type\s+\w+State\s*=[\s\S]*?)(\s*;)/;
  const hasStateUnion = stateUnion.test(stateContent);
  if (!hasStateUnion) {
    throw new Error(`No "export type <Name>State = ...;" union found in ${relToCwd(files.typesStateFile)}; nothing was changed.`);
  }
  stateContent = stateContent.replace(stateUnion, (_m, head, tail) => `${head}\n${newMember}${tail}`);
  const committed = commitCapsuleEdits([{ path: files.typesStateFile, content: stateContent }], { ...opts, isDryRun });
  updatedFiles.push(...committed.updatedFiles);

  return { success: true, dryRun: isDryRun, statusName: cleanStatus, updatedFiles, diff: committed.diff };
};

export const addActionToController = (targetPath, actionName, options = {}) => {
  const cleanAction = actionName.trim().replace(/^handle/, '');
  const pascalAction = toPascalCase(cleanAction);
  const handlerName = `handle${pascalAction}`;

  const files = resolveCapsuleFiles(targetPath, options.cwd || process.cwd());
  const updatedFiles = [];
  const isDryRun = Boolean(options.dryRun || options['dry-run']);

  const hasTarget = Boolean(files.controllerPath) && fs.existsSync(files.controllerPath);
  if (!hasTarget) {
    throw new Error(`No controller file found in capsule at ${targetPath}.`);
  }

  let controllerContent = fs.readFileSync(files.controllerPath, 'utf-8');
  if (controllerContent.includes(`const ${handlerName} =`)) {
    return { success: true, alreadyExists: true, handlerName, updatedFiles };
  }

  if (controllerContent.includes('ControllerOptions') && !controllerContent.includes(`on${pascalAction}?:`)) {
    controllerContent = controllerContent.replace(
      /(interface\s+ControllerOptions\s*\{[\s\S]*?)(\n\s*\})/,
      (_m, head, tail) => `${head}\n  readonly on${pascalAction}?: () => void;${tail}`
    );
  }

  const handlerCode = `  const ${handlerName} = () => {\n    if (!canProceed) return;\n    options.on${pascalAction}?.();\n  };\n\n`;

  const returnBlock = /(\n\s*return\s*\{)/;
  const hasReturnBlock = returnBlock.test(controllerContent);
  if (!hasReturnBlock) {
    throw new Error(`No "return {" block found in ${relToCwd(files.controllerPath)}; nothing was changed.`);
  }
  controllerContent = controllerContent.replace(returnBlock, (_m, head) => `\n${handlerCode}${head}`);

  controllerContent = controllerContent.replace(
    /(return\s*\{[\s\S]*?)(\s*\};)/,
    (match, p1, p2) => {
      const trimmed = p1.trimEnd();
      const needsComma = !trimmed.endsWith(',');
      return `${trimmed}${needsComma ? ',' : ''} ${handlerName} ${p2.trim()}`;
    }
  );

  const committed = commitCapsuleEdits([{ path: files.controllerPath, content: controllerContent }], { ...options, isDryRun });
  updatedFiles.push(...committed.updatedFiles);

  return { success: true, dryRun: isDryRun, handlerName, updatedFiles, diff: committed.diff };
};

export const autoFixFile = (targetFile, options = {}) => {
  const absPath = path.resolve(options.cwd || process.cwd(), targetFile);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${targetFile}`);
  }

  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    return runAutofix(absPath, options);
  }

  const result = runAutofix(absPath, options);
  return {
    file: path.relative(process.cwd(), absPath),
    dryRun: result.dryRun,
    fixed: result.filesChanged > 0,
    replacementsCount: result.totalFixes,
    fixes: result.fixes,
    suggestions: result.suggestions,
    skipped: result.skipped,
    ...(result.diff ? { diff: result.diff } : {})
  };
};

export const runMutatorCli = async (rawArgs = [], isCli = true) => {
  const isJson = rawArgs.includes('--json');
  const isDryRun = rawArgs.includes('--dry-run') || rawArgs.includes('-n');
  const nonFlags = rawArgs.filter((a) => !a.startsWith('-'));
  const first = nonFlags[0] || '';
  const second = nonFlags[1] || '';

  let command = first;
  let target = second;
  let value = nonFlags[2] || '';
  let extra = nonFlags.slice(3).join(' ');

  if (first === 'add' && ['prop', 'state', 'action'].includes(second)) {
    command = `add:${second}`;
    target = nonFlags[2] || '';
    value = nonFlags[3] || '';
    extra = nonFlags.slice(4).join(' ');
  }

  try {
    let result = null;

    if (command === 'add:prop') {
      const hasArgs = Boolean(target) && Boolean(value);
      if (!hasArgs) {
        throw new Error('Usage: chemx add:prop <capsule-path> <name>:<type>');
      }
      result = addPropToCapsule(target, value, { dryRun: isDryRun });
    } else if (command === 'add:state') {
      const hasArgs = Boolean(target) && Boolean(value);
      if (!hasArgs) {
        throw new Error('Usage: chemx add:state <capsule-path> <statusName> [payload]');
      }
      result = addStateToCapsule(target, value, extra, { dryRun: isDryRun });
    } else if (command === 'add:action') {
      const hasArgs = Boolean(target) && Boolean(value);
      if (!hasArgs) {
        throw new Error('Usage: chemx add:action <capsule-path> <actionName>');
      }
      result = addActionToController(target, value, { dryRun: isDryRun });
    } else if (command === 'fix') {
      const fixTarget = target || 'src';
      result = autoFixFile(fixTarget, { dryRun: isDryRun });
    } else {
      throw new Error(`Unknown mutator command "${command}". Available: add:prop, add:state, add:action, fix`);
    }

    if (isJson) {
      process.stdout.write(JSON.stringify({ success: true, command, ...result }) + '\n');
      if (isCli) process.exit(0);
      return result;
    }

    if (result.dryRun) {
      const wouldUpdate = result.updatedFiles || [...new Set((result.fixes || []).map((f) => f.file))];
      process.stdout.write(`\n\x1b[1m\x1b[33m[DRY RUN]\x1b[0m Would update ${wouldUpdate.length} file(s):\n`);
      for (const f of wouldUpdate) {
        process.stdout.write(`  \x1b[33m•\x1b[0m ${f}\n`);
      }
      if (result.diff) process.stdout.write(`\n${result.diff}\n`);
      for (const s of result.suggestions || []) {
        process.stdout.write(`  suggestion ${s.file || ''}:${s.line} ${s.rule}: ${s.suggestion}\n`);
      }
      process.stdout.write('\n\x1b[2mDry run complete. No files were written to disk.\x1b[0m\n\n');
      if (isCli) process.exit(0);
      return result;
    }

    process.stdout.write(`\n${ANSI.BOLD}${ANSI.LIME}✔ Chemical X Surgical Mutation Applied:${ANSI.RESET}\n`);
    if (result.updatedFiles) {
      for (const f of result.updatedFiles) {
        process.stdout.write(`  ${ANSI.CYAN}•${ANSI.RESET} Updated ${f}\n`);
      }
    }
    const skippedEntries = result.skipped || [];
    for (const s of skippedEntries) {
      process.stdout.write(`  ${ANSI.GOLD}•${ANSI.RESET} Skipped ${s.file}: ${s.reason}\n`);
    }
    const isReportedFile = result.fixed !== undefined && skippedEntries.length === 0;
    if (isReportedFile) {
      const msg = result.fixed ? `Fixed ${result.replacementsCount} mechanical hazard(s)` : 'File was already clean';
      process.stdout.write(`  ${ANSI.MINT}•${ANSI.RESET} ${msg} in ${result.file}\n`);
    }
    process.stdout.write('\n');

    if (isCli) process.exit(0);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (isJson) {
      process.stdout.write(JSON.stringify({ success: false, error: errorMsg }) + '\n');
    } else {
      process.stderr.write(`\n${ANSI.BOLD}${ANSI.RED}✕ ${errorMsg}${ANSI.RESET}\n\n`);
    }
    if (isCli) process.exit(1);
    throw err;
  }
};
