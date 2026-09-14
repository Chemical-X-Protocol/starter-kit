import path from 'node:path';
import { parse } from '@babel/parser';
import { extractParseableCode } from './audit/rules-helpers.js';

const TIER_PATTERNS = [
  { tier: 'atom', test: (p, b) => p.includes('atoms/') || p.includes('/a-') || b.startsWith('a-') },
  { tier: 'molecule', test: (p, b) => p.includes('molecules/') || p.includes('/m-') || b.startsWith('m-') },
  { tier: 'organism', test: (p, b) => p.includes('organisms/') || p.includes('/o-') || b.startsWith('o-') },
  { tier: 'template', test: (p, b) => p.includes('templates/') || p.includes('/t-') || b.startsWith('t-') },
  { tier: 'view', test: (p, b) => p.includes('/views/') || p.includes('/pages/') || p.includes('/routes/') || /View\.[tj]sx?$/.test(b) },
  { tier: 'hook', test: (p, b) => p.includes('/hooks/') || p.includes('/composables/') || /^use[A-Z]/.test(b) },
  { tier: 'type', test: (p, b) => b.endsWith('.d.ts') || p.includes('/types/') }
];

export const resolveArchitectureTier = (relativePath) => {
  const baseName = path.basename(relativePath);
  for (const { tier, test } of TIER_PATTERNS) {
    if (test(relativePath, baseName)) return tier;
  }
  return 'utility';
};

const extractRegexFallback = (content) => {
  const symbols = [];
  const exportMatches = content.matchAll(/export\s+(?:const|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/g);
  for (const m of exportMatches) {
    symbols.push({ name: m[1], kind: 'symbol', isExport: true });
  }

  const hooks = new Set();
  const hookMatches = content.matchAll(/\b(use[A-Z0-9][A-Za-z0-9_$]*)\b/g);
  for (const h of hookMatches) {
    hooks.add(h[1]);
  }

  const props = [];
  const propMatches = content.matchAll(/(?:readonly\s+)?([A-Za-z0-9_$]+)\s*\??\s*:\s*([^;,\n]+)[;,]/g);
  for (const p of propMatches) {
    if (props.length < 20 && !['string', 'number', 'boolean', 'void'].includes(p[1])) {
      props.push({ name: p[1], type: p[2].trim() });
    }
  }

  return { symbols, props, hooks: Array.from(hooks) };
};

export const extractAstMetadata = (content, filePath) => {
  const ext = path.extname(filePath);
  const code = extractParseableCode(content, ext);

  const symbols = [];
  const props = [];
  const hooks = new Set();

  try {
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx']
    });

    const body = ast.program.body || [];
    for (const node of body) {
      if (node.type === 'ExportNamedDeclaration') {
        const decl = node.declaration;
        if (decl) {
          if (decl.type === 'FunctionDeclaration' && decl.id) {
            symbols.push({ name: decl.id.name, kind: 'function', isExport: true });
          } else if (decl.type === 'ClassDeclaration' && decl.id) {
            symbols.push({ name: decl.id.name, kind: 'class', isExport: true });
          } else if (decl.type === 'VariableDeclaration') {
            for (const v of decl.declarations) {
              if (v.id && v.id.name) {
                symbols.push({ name: v.id.name, kind: 'const', isExport: true });
              }
            }
          } else if (decl.type === 'TSTypeAliasDeclaration' && decl.id) {
            symbols.push({ name: decl.id.name, kind: 'type', isExport: true });
          } else if (decl.type === 'TSInterfaceDeclaration' && decl.id) {
            symbols.push({ name: decl.id.name, kind: 'interface', isExport: true });
            if (/props?/i.test(decl.id.name)) {
              for (const member of decl.body.body || []) {
                if (member.type === 'TSPropertySignature' && member.key && member.key.name) {
                  props.push({ name: member.key.name, type: 'ts' });
                }
              }
            }
          }
        }
      } else if (node.type === 'ExportDefaultDeclaration') {
        const decl = node.declaration;
        const name = decl?.id?.name || path.basename(filePath, ext);
        symbols.push({ name, kind: 'default', isExport: true });
      } else if (node.type === 'TSInterfaceDeclaration' && node.id) {
        if (/props?/i.test(node.id.name)) {
          for (const member of node.body.body || []) {
            if (member.type === 'TSPropertySignature' && member.key && member.key.name) {
              props.push({ name: member.key.name, type: 'ts' });
            }
          }
        }
      }
    }

    // Fast hook call discovery
    const hookMatches = code.matchAll(/\b(use[A-Z0-9][A-Za-z0-9_$]*)\b/g);
    for (const h of hookMatches) {
      hooks.add(h[1]);
    }

    return { symbols, props, hooks: Array.from(hooks) };
  } catch {
    return extractRegexFallback(content);
  }
};
