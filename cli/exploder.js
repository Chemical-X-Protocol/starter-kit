/**
 * Chemical X Capsule Exploder
 * Atomically unpacks a "liquid" single-file compact capsule into a standard crystalline multi-file directory capsule.
 * Transactional: Uses .temp.bak and rolls back if post-unpack verification fails.
 */

import fs from 'node:fs';
import path from 'node:path';
import * as babelParser from '@babel/parser';
import { toPascalCase } from './generator-templates/naming.js';
import { buildComponentSpec, buildIndex } from './generator-templates/specs.js';
import { buildTypesIndex } from './generator-templates/types.js';
import { detectTestRunner } from './project-detector.js';

export const parseCompactFile = (content, ext = 'tsx') => {
  const isTsx = ext === 'tsx' || ext === 'jsx';
  const plugins = ['typescript'];
  if (isTsx) plugins.push('jsx');

  const ast = babelParser.parse(content, {
    sourceType: 'module',
    plugins
  });

  const lines = content.split('\n');
  const getSlice = (node) => {
    return lines.slice(node.loc.start.line - 1, node.loc.end.line).join('\n');
  };

  const typesProps = [];
  const typesState = [];
  let controllerHookCode = null;
  let componentCode = null;
  const reactImports = new Set();

  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration') {
      if (node.source.value === 'react') {
        for (const spec of node.specifiers) {
          if (spec.imported?.name) reactImports.add(spec.imported.name);
        }
      }
      continue;
    }

    // Capture TypeScript interfaces and type aliases
    const isExportedType = node.type === 'ExportNamedDeclaration' &&
      (node.declaration?.type === 'TSInterfaceDeclaration' || node.declaration?.type === 'TSTypeAliasDeclaration');

    if (isExportedType) {
      const typeName = node.declaration.id?.name || '';
      const slice = getSlice(node);
      const isPropsOrEmits = typeName.includes('Props') || typeName.includes('Emits');
      if (isPropsOrEmits) {
        typesProps.push(slice);
      } else {
        typesState.push(slice);
      }
      continue;
    }

    // Capture Controller Hook
    const isExportedVar = node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration';
    if (isExportedVar) {
      const decl = node.declaration.declarations[0];
      const varName = decl?.id?.name || '';
      const isControllerHook = varName.startsWith('use') && varName.endsWith('Controller');
      if (isControllerHook) {
        controllerHookCode = getSlice(node);
        continue;
      }
      if (varName && !varName.startsWith('use')) {
        componentCode = getSlice(node);
        continue;
      }
    }

    if (node.type === 'ExportDefaultDeclaration') {
      continue;
    }
  }

  return {
    typesProps: typesProps.join('\n\n'),
    typesState: typesState.join('\n\n'),
    controllerHookCode,
    componentCode,
    reactImports: Array.from(reactImports)
  };
};

export const explodeCapsule = (targetFilePath, options = {}) => {
  const cwd = options.cwd || process.cwd();
  const absPath = path.resolve(cwd, targetFilePath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Target file not found at ${absPath}`);
  }

  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    throw new Error(`Target ${targetFilePath} is already a directory capsule.`);
  }

  const fileName = path.basename(absPath);
  const ext = path.extname(absPath).replace('.', '');
  const capsuleName = fileName.replace(/\.[^.]+$/, '');
  const parentDir = path.dirname(absPath);
  const targetDir = path.join(parentDir, capsuleName);
  const bakPath = `${absPath}.temp.bak`;

  if (fs.existsSync(targetDir)) {
    throw new Error(`Destination directory ${capsuleName} already exists.`);
  }

  const content = fs.readFileSync(absPath, 'utf-8');
  const baseSlug = capsuleName.replace(/^[a-z]+-/, '');
  const pascalName = toPascalCase(baseSlug);

  if (options.dryRun) {
    parseCompactFile(content, ext);
    return {
      success: true,
      dryRun: true,
      capsuleName,
      targetDir: path.relative(cwd, targetDir),
      files: [
        `${capsuleName}.${ext}`,
        `${capsuleName}.controller.ts`,
        `${capsuleName}.spec.ts`,
        'index.ts',
        'types/props.d.ts',
        'types/state.d.ts',
        'types/index.ts',
        'types.d.ts'
      ]
    };
  }

  // 1. Transactional Backup Snapshot
  fs.copyFileSync(absPath, bakPath);

  try {
    const parsed = parseCompactFile(content, ext);

    // 2. Create Directory Capsule Structure
    fs.mkdirSync(targetDir, { recursive: true });
    const typesDir = path.join(targetDir, 'types');
    fs.mkdirSync(typesDir, { recursive: true });

    // 3. Types Files
    let propsContent = parsed.typesProps || `export interface ${pascalName}Props {\n  readonly className?: string;\n}\n`;
    const usesReactNode = propsContent.includes('ReactNode') && !propsContent.includes("from 'react'");
    if (usesReactNode) {
      propsContent = `import type { ReactNode } from 'react';\n\n${propsContent}`;
    }
    const stateContent = parsed.typesState || `export interface ${pascalName}State {\n  readonly isActive: boolean;\n}\n`;

    fs.writeFileSync(path.join(typesDir, 'props.d.ts'), `${propsContent}\n`, 'utf-8');
    fs.writeFileSync(path.join(typesDir, 'state.d.ts'), `${stateContent}\n`, 'utf-8');
    fs.writeFileSync(path.join(typesDir, 'index.ts'), buildTypesIndex(['props', 'state']), 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'types.d.ts'), "export * from './types/index';\n", 'utf-8');

    // 4. Controller File
    const hookCode = parsed.controllerHookCode ||
      `export const use${pascalName}Controller = () => {\n  const [isActive, setIsActive] = useState<boolean>(false);\n  return { isActive };\n};`;
    const controllerImports = "import { useState, useMemo } from 'react';\n";
    fs.writeFileSync(path.join(targetDir, `${capsuleName}.controller.ts`), `${controllerImports}\n${hookCode}\n`, 'utf-8');

    // 5. Component File
    const compImports = `import type { ${pascalName}Props } from './types';\nimport { use${pascalName}Controller } from './${capsuleName}.controller';\n\n`;
    const compBody = parsed.componentCode || `export const ${pascalName} = ({ className = '' }: ${pascalName}Props) => {\n  return <div className="${capsuleName}" />;\n};`;
    const compContent = `${compImports}${compBody}\n\nexport default ${pascalName};\n`;
    fs.writeFileSync(path.join(targetDir, `${capsuleName}.${ext}`), compContent, 'utf-8');

    // 6. Index & Spec
    const hasController = Boolean(parsed.controllerHookCode);
    const runner = detectTestRunner(targetDir);
    fs.writeFileSync(path.join(targetDir, 'index.ts'), buildIndex(capsuleName, pascalName, ext, hasController), 'utf-8');
    fs.writeFileSync(path.join(targetDir, `${capsuleName}.spec.ts`), buildComponentSpec(capsuleName, pascalName, hasController, runner), 'utf-8');

    // 7. Verify Unpacked Directory (Syntactic AST Parse Verification)
    babelParser.parse(fs.readFileSync(path.join(targetDir, `${capsuleName}.${ext}`), 'utf-8'), {
      sourceType: 'module',
      plugins: ['typescript', 'jsx']
    });

    // 8. Success: Delete source file and backup
    fs.unlinkSync(absPath);
    if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);

    return {
      success: true,
      capsuleName,
      targetDir: path.relative(cwd, targetDir),
      files: [
        `${capsuleName}.${ext}`,
        `${capsuleName}.controller.ts`,
        `${capsuleName}.spec.ts`,
        'index.ts',
        'types/props.d.ts',
        'types/state.d.ts',
        'types/index.ts',
        'types.d.ts'
      ]
    };
  } catch (err) {
    // Transactional Rollback
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    if (fs.existsSync(bakPath)) {
      fs.copyFileSync(bakPath, absPath);
      fs.unlinkSync(bakPath);
    }
    throw new Error(`Explode transaction aborted and rolled back: ${err.message}`);
  }
};

export const runExplodeCli = async (rawArgs = [], isCli = true) => {
  const isJson = rawArgs.includes('--json');
  const isDryRun = rawArgs.includes('--dry-run') || rawArgs.includes('-n');
  const target = rawArgs.find((a) => !a.startsWith('-'));

  if (!target) {
    const msg = 'Usage: npx chemx explode <file-path> [--dry-run] [--json]';
    if (isJson) {
      process.stdout.write(JSON.stringify({ error: msg, success: false }) + '\n');
    } else {
      process.stderr.write(`\x1b[31m✕ Error: ${msg}\x1b[0m\n`);
    }
    if (isCli) process.exit(1);
    return { error: msg, success: false };
  }

  try {
    const result = explodeCapsule(target, { dryRun: isDryRun });
    if (isJson) {
      process.stdout.write(JSON.stringify(result) + '\n');
    } else {
      process.stdout.write(`\n\x1b[1m\x1b[32m✔ Successfully exploded capsule:\x1b[0m \x1b[36m${result.targetDir}/\x1b[0m\n`);
      for (const f of result.files) {
        process.stdout.write(`  \x1b[32m✔\x1b[0m ${f}\n`);
      }
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
