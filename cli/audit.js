import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

const countLogicalOperators = (node) => {
  let count = 0;
  if (t.isLogicalExpression(node)) {
    count += 1;
    count += countLogicalOperators(node.left);
    count += countLogicalOperators(node.right);
  } else if (t.isUnaryExpression(node) && node.operator === '!') {
    count += 1;
    count += countLogicalOperators(node.argument);
  }
  return count;
};

const extractParseableCode = (content, ext) => {
  if (ext === '.vue') {
    const scriptMatch = content.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
    return scriptMatch ? scriptMatch[1] : '';
  }
  return content;
};

export const auditFile = (filePath, relativePath) => {
  const violations = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const lineCount = lines.length;
  const ext = path.extname(filePath);

  // 1. Line Budget Checks
  const isMolecule = relativePath.includes('molecules') || relativePath.includes('/m-');
  if (lineCount > 500) {
    violations.push({
      filePath: relativePath,
      line: 1,
      hazard: `File line budget exceeded (${lineCount} > 500 lines)`,
      rule: 'LINE_BUDGET_FILE',
      directive: 'Decompose monolith into domain capsules and molecules'
    });
  } else if (isMolecule && lineCount > 100) {
    violations.push({
      filePath: relativePath,
      line: 1,
      hazard: `Molecule capsule budget exceeded (${lineCount} > 100 lines)`,
      rule: 'LINE_BUDGET_MOLECULE',
      directive: 'Split molecule into focused sub-molecules or extract state to hook'
    });
  }

  const codeToParse = extractParseableCode(content, ext);
  if (!codeToParse.trim()) {
    return violations;
  }

  let ast;
  try {
    ast = parse(codeToParse, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx']
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    violations.push({
      filePath: relativePath,
      line: 1,
      hazard: `Parse error: ${errorMsg}`,
      rule: 'SYNTAX_PARSE_ERROR',
      directive: 'Fix syntax errors before static analysis'
    });
    return violations;
  }

  const traverseFn = traverse.default || traverse;

  traverseFn(ast, {
    // 2. Hook Saturation Check
    Function(astPath) {
      let hookCount = 0;
      astPath.traverse({
        CallExpression(callPath) {
          if (t.isIdentifier(callPath.node.callee) && /^use[A-Z0-9]/.test(callPath.node.callee.name)) {
            if (callPath.getFunctionParent() === astPath) {
              hookCount += 1;
            }
          }
        }
      });

      if (hookCount > 5) {
        const line = astPath.node.loc?.start.line || 1;
        violations.push({
          filePath: relativePath,
          line,
          hazard: `Hook saturation detected (${hookCount} hooks > 5 limit)`,
          rule: 'HOOK_SATURATION',
          directive: 'Extract related state and effects into dedicated domain hooks'
        });
      }
    },

    // 3. Control Flow Complexity
    JSXExpressionContainer(astPath) {
      const expr = astPath.node.expression;
      if (t.isLogicalExpression(expr) || t.isUnaryExpression(expr)) {
        const opCount = countLogicalOperators(expr);
        if (opCount > 2) {
          const line = expr.loc?.start.line || astPath.node.loc?.start.line || 1;
          violations.push({
            filePath: relativePath,
            line,
            hazard: `Inline boolean complexity (${opCount} logical operators > 2 limit)`,
            rule: 'CONTROL_FLOW_INLINE_BOOLEAN',
            directive: 'Compose booleans into Stage 1 concepts and Stage 2 decision variables'
          });
        }
      }
    },

    ConditionalExpression(astPath) {
      if (t.isConditionalExpression(astPath.node.consequent) || t.isConditionalExpression(astPath.node.alternate)) {
        const line = astPath.node.loc?.start.line || 1;
        violations.push({
          filePath: relativePath,
          line,
          hazard: 'Nested ternary operator detected',
          rule: 'CONTROL_FLOW_NESTED_TERNARY',
          directive: 'Extract display states into computed descriptor objects or early returns'
        });
      }
    },

    // 4. Timer Discipline
    CallExpression(astPath) {
      const callee = astPath.node.callee;
      if (t.isIdentifier(callee) && (callee.name === 'setInterval' || callee.name === 'setTimeout')) {
        const fnParent = astPath.getFunctionParent();
        let hasCleanup = false;
        if (fnParent) {
          fnParent.traverse({
            ReturnStatement(retPath) {
              if (retPath.node.argument) {
                hasCleanup = true;
              }
            }
          });
        }

        if (!hasCleanup) {
          const line = astPath.node.loc?.start.line || 1;
          violations.push({
            filePath: relativePath,
            line,
            hazard: `Raw ${callee.name} lacking lifecycle scope disposal`,
            rule: 'TIMER_DISCIPLINE',
            directive: 'Wrap timers in self-cleaning hooks returning cleanup disposers'
          });
        }
      }
    },

    // 5. Type Co-location
    TSTypeLiteral(astPath) {
      if (astPath.node.members.length > 3) {
        if (!astPath.findParent((p) => p.isTSTypeAliasDeclaration() || p.isTSInterfaceDeclaration())) {
          const line = astPath.node.loc?.start.line || 1;
          violations.push({
            filePath: relativePath,
            line,
            hazard: `Inlined anonymous complex type (${astPath.node.members.length} members)`,
            rule: 'TYPE_COLOCATION',
            directive: 'Define co-located domain interfaces in types/*.d.ts'
          });
        }
      }
    }
  });

  return violations;
};

export const scanDirectory = (targetDir, baseDir) => {
  let results = [];
  if (!fs.existsSync(targetDir)) return results;

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(targetDir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git', '.next', 'out'].includes(entry.name)) {
        results = results.concat(scanDirectory(fullPath, baseDir));
      }
    } else if (/\.(tsx|ts|jsx|js|vue)$/.test(entry.name) && !entry.name.endsWith('.d.ts') && !entry.name.includes('.test.')) {
      results = results.concat(auditFile(fullPath, relPath));
    }
  }
  return results;
};

const countTotalScannedFiles = (targetDir) => {
  let count = 0;
  if (!fs.existsSync(targetDir)) return count;

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git', '.next', 'out'].includes(entry.name)) {
        count += countTotalScannedFiles(fullPath);
      }
    } else if (/\.(tsx|ts|jsx|js|vue)$/.test(entry.name) && !entry.name.endsWith('.d.ts') && !entry.name.includes('.test.')) {
      count += 1;
    }
  }
  return count;
};

export const runAudit = (targetDir = 'src') => {
  const cwd = process.cwd();
  const absoluteTarget = path.resolve(cwd, targetDir);
  const violations = scanDirectory(absoluteTarget, cwd);
  const scannedFiles = countTotalScannedFiles(absoluteTarget);

  return {
    scannedFiles,
    totalViolations: violations.length,
    violations
  };
};

export default {
  auditFile,
  scanDirectory,
  runAudit
};
