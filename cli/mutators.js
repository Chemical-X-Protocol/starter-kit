import fs from 'node:fs';
import path from 'node:path';
import { toPascalCase } from './generator-templates.js';
import { ANSI } from './theme.js';

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

  if (!files.typesPropsFile || !fs.existsSync(files.typesPropsFile)) {
    throw new Error(`No props type file found in capsule at ${targetPath}.`);
  }

  let typesContent = fs.readFileSync(files.typesPropsFile, 'utf-8');
  const regexExists = new RegExp(`\\b${propName}\\??\\s*:`);
  if (regexExists.test(typesContent)) {
    return { success: true, alreadyExists: true, propName, propType, updatedFiles };
  }

  const propDeclaration = `  readonly ${propName}${isOptional ? '?' : ''}: ${propType};\n`;
  typesContent = typesContent.replace(/(interface\s+\w+Props\s*\{[\s\S]*?)(\n\s*\})/, `$1\n${propDeclaration}$2`);
  if (!isDryRun) {
    fs.writeFileSync(files.typesPropsFile, typesContent, 'utf-8');
  }
  updatedFiles.push(path.relative(process.cwd(), files.typesPropsFile));

  if (files.compPath && fs.existsSync(files.compPath)) {
    let compContent = fs.readFileSync(files.compPath, 'utf-8');
    let compModified = false;

    if (files.compExt === 'tsx' && !compContent.includes(propName)) {
      const fcMatch = compContent.match(/(\(\{\s*\n\s*)([a-zA-Z0-9_]+)/);
      if (fcMatch) {
        compContent = compContent.replace(fcMatch[0], `${fcMatch[1]}${propName},\n  ${fcMatch[2]}`);
        compModified = true;
      }
    } else if (files.compExt === 'svelte' && !compContent.includes(propName)) {
      const svelteMatch = compContent.match(/(const\s*\{\s*\n\s*)([a-zA-Z0-9_]+)/);
      if (svelteMatch) {
        compContent = compContent.replace(svelteMatch[0], `${svelteMatch[1]}${propName},\n  ${svelteMatch[2]}`);
        compModified = true;
      }
    }

    if (compModified) {
      if (!isDryRun) {
        fs.writeFileSync(files.compPath, compContent, 'utf-8');
      }
      updatedFiles.push(path.relative(process.cwd(), files.compPath));
    }
  }

  return { success: true, dryRun: isDryRun, propName, propType, updatedFiles };
};

export const addStateToCapsule = (targetPath, statusName, payload = '', options = {}) => {
  const cleanStatus = statusName.trim().toLowerCase();
  const opts = typeof options === 'object' ? options : {};
  const isDryRun = Boolean(opts.dryRun || opts['dry-run']);
  const files = resolveCapsuleFiles(targetPath, opts.cwd || process.cwd());
  const updatedFiles = [];

  if (!files.typesStateFile || !fs.existsSync(files.typesStateFile)) {
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

  stateContent = stateContent.replace(/(export\s+type\s+\w+State\s*=[\s\S]*?)(\s*;)/, `$1\n${newMember}$2`);
  if (!isDryRun) {
    fs.writeFileSync(files.typesStateFile, stateContent, 'utf-8');
  }
  updatedFiles.push(path.relative(process.cwd(), files.typesStateFile));

  return { success: true, dryRun: isDryRun, statusName: cleanStatus, updatedFiles };
};

export const addActionToController = (targetPath, actionName, options = {}) => {
  const cleanAction = actionName.trim().replace(/^handle/, '');
  const pascalAction = toPascalCase(cleanAction);
  const handlerName = `handle${pascalAction}`;

  const files = resolveCapsuleFiles(targetPath, options.cwd || process.cwd());
  const updatedFiles = [];
  const isDryRun = Boolean(options.dryRun || options['dry-run']);

  if (!files.controllerPath || !fs.existsSync(files.controllerPath)) {
    throw new Error(`No controller file found in capsule at ${targetPath}.`);
  }

  let controllerContent = fs.readFileSync(files.controllerPath, 'utf-8');
  if (controllerContent.includes(`const ${handlerName} =`)) {
    return { success: true, alreadyExists: true, handlerName, updatedFiles };
  }

  if (controllerContent.includes('ControllerOptions') && !controllerContent.includes(`on${pascalAction}?:`)) {
    controllerContent = controllerContent.replace(
      /(interface\s+ControllerOptions\s*\{[\s\S]*?)(\n\s*\})/,
      `$1\n  readonly on${pascalAction}?: () => void;$2`
    );
  }

  const handlerCode = `  const ${handlerName} = () => {\n    if (!canProceed) return;\n    options.on${pascalAction}?.();\n  };\n\n`;

  controllerContent = controllerContent.replace(/(\n\s*return\s*\{)/, `\n${handlerCode}$1`);

  controllerContent = controllerContent.replace(
    /(return\s*\{[\s\S]*?)(\s*\};)/,
    (match, p1, p2) => {
      const trimmed = p1.trimEnd();
      const needsComma = !trimmed.endsWith(',');
      return `${trimmed}${needsComma ? ',' : ''} ${handlerName} ${p2.trim()}`;
    }
  );

  if (!isDryRun) {
    fs.writeFileSync(files.controllerPath, controllerContent, 'utf-8');
  }
  updatedFiles.push(path.relative(process.cwd(), files.controllerPath));

  return { success: true, dryRun: isDryRun, handlerName, updatedFiles };
};

export const autoFixFile = (targetFile, options = {}) => {
  const absPath = path.resolve(options.cwd || process.cwd(), targetFile);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${targetFile}`);
  }

  let content = fs.readFileSync(absPath, 'utf-8');
  let replacementsCount = 0;

  if (content.includes('\u2014')) {
    const matches = content.match(/\u2014/g);
    replacementsCount += matches ? matches.length : 1;
    content = content.replace(/\u2014/g, ' - ');
  }

  const timeoutMatch = content.match(/setTimeout\(([^,]+),\s*0\)/g);
  if (timeoutMatch) {
    replacementsCount += timeoutMatch.length;
    content = content.replace(/setTimeout\(([^,]+),\s*0\)/g, 'queueMicrotask($1)');
  }

  if (replacementsCount > 0) {
    fs.writeFileSync(absPath, content, 'utf-8');
  }

  return {
    file: path.relative(process.cwd(), absPath),
    fixed: replacementsCount > 0,
    replacementsCount
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
      if (!target || !value) {
        throw new Error('Usage: chemx add:prop <capsule-path> <name>:<type>');
      }
      result = addPropToCapsule(target, value, { dryRun: isDryRun });
    } else if (command === 'add:state') {
      if (!target || !value) {
        throw new Error('Usage: chemx add:state <capsule-path> <statusName> [payload]');
      }
      result = addStateToCapsule(target, value, extra, { dryRun: isDryRun });
    } else if (command === 'add:action') {
      if (!target || !value) {
        throw new Error('Usage: chemx add:action <capsule-path> <actionName>');
      }
      result = addActionToController(target, value, { dryRun: isDryRun });
    } else if (command === 'fix') {
      if (!target) {
        throw new Error('Usage: chemx fix <file-path>');
      }
      result = autoFixFile(target);
    } else {
      throw new Error(`Unknown mutator command "${command}". Available: add:prop, add:state, add:action, fix`);
    }

    if (isJson) {
      process.stdout.write(JSON.stringify({ success: true, command, ...result }) + '\n');
      if (isCli) process.exit(0);
      return result;
    }

    if (result.dryRun) {
      process.stdout.write(`\n\x1b[1m\x1b[33m[DRY RUN]\x1b[0m Would update ${result.updatedFiles?.length || 0} file(s):\n`);
      for (const f of result.updatedFiles || []) {
        process.stdout.write(`  \x1b[33m•\x1b[0m ${f}\n`);
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
    if (result.fixed !== undefined) {
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
