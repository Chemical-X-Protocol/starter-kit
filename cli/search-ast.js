import path from 'node:path';
import { parse } from '@babel/parser';
import { extractParseableCode } from './audit/rules-helpers.js';
import { isBabelParsable } from './languages.js';

const TIER_PATTERNS = [
  { tier: 'atom', test: (p, b) => p.includes('atoms/') || p.includes('/a-') || b.startsWith('a-') || /(?:^|[\\/])(?:Domain|Entities|Models)[\\/]/i.test(p) },
  { tier: 'molecule', test: (p, b) => p.includes('molecules/') || p.includes('/m-') || b.startsWith('m-') || /(?:^|[\\/])Features[\\/]/i.test(p) },
  { tier: 'organism', test: (p, b) => p.includes('organisms/') || p.includes('/o-') || b.startsWith('o-') || /(?:^|[\\/])(?:Services|Handlers|Commands|Queries)[\\/]/i.test(p) },
  { tier: 'template', test: (p, b) => p.includes('templates/') || p.includes('/t-') || b.startsWith('t-') },
  { tier: 'view', test: (p, b) => p.includes('/views/') || p.includes('/pages/') || p.includes('/routes/') || /(?:^|[\\/])(?:Controllers|Endpoints)[\\/]/i.test(p) || /View\.[tj]sx?$/.test(b) || /Controller\.cs$/.test(b) },
  { tier: 'hook', test: (p, b) => p.includes('/hooks/') || p.includes('/composables/') || /^use[A-Z]/.test(b) },
  { tier: 'type', test: (p, b) => b.endsWith('.d.ts') || p.includes('/types/') || /(?:^|[\\/])(?:Dtos|Contracts)[\\/]/i.test(p) }
];

export const resolveArchitectureTier = (relativePath) => {
  const baseName = path.basename(relativePath);
  for (const { tier, test } of TIER_PATTERNS) {
    if (test(relativePath, baseName)) return tier;
  }
  return 'utility';
};

const extractRegexFallback = (content, filePath = '') => {
  const symbols = [];
  const imports = [];
  const hooks = new Set();
  const props = [];

  const exportMatches = content.matchAll(/export\s+(?:const|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/g);
  for (const m of exportMatches) {
    symbols.push({ name: m[1], kind: 'symbol', isExport: true, startLine: 1, endLine: 1, signature: '' });
  }

  const csMatches = content.matchAll(/(?:public|internal|protected)\s+(?:static\s+|sealed\s+|abstract\s+|partial\s+)*(?:class|record|interface|struct|enum)\s+([A-Za-z0-9_]+)/g);
  for (const m of csMatches) {
    symbols.push({ name: m[1], kind: 'class', isExport: true, startLine: 1, endLine: 1, signature: '' });
  }

  const pyMatches = content.matchAll(/(?:def|class)\s+([A-Za-z0-9_]+)/g);
  for (const m of pyMatches) {
    symbols.push({ name: m[1], kind: 'function', isExport: true, startLine: 1, endLine: 1, signature: '' });
  }

  const goMatches = content.matchAll(/(?:func(?:\s*\([^)]*\))?\s+|type\s+)([A-Za-z0-9_]+)/g);
  for (const m of goMatches) {
    symbols.push({ name: m[1], kind: 'function', isExport: true, startLine: 1, endLine: 1, signature: '' });
  }

  const csImports = content.matchAll(/using\s+([A-Za-z0-9_.]+);/g);
  for (const m of csImports) {
    imports.push({ importedSymbol: '*', sourceModule: m[1], line: 1 });
  }

  const pyImports = content.matchAll(/(?:import\s+([A-Za-z0-9_.]+)|from\s+([A-Za-z0-9_.]+)\s+import)/g);
  for (const m of pyImports) {
    const mod = m[1] || m[2];
    imports.push({ importedSymbol: '*', sourceModule: mod, line: 1 });
  }

  const hookMatches = content.matchAll(/\b(use[A-Z0-9][A-Za-z0-9_$]*)\b/g);
  for (const h of hookMatches) {
    hooks.add(h[1]);
  }

  const propMatches = content.matchAll(/(?:readonly\s+)?([A-Za-z0-9_$]+)\s*\??\s*:\s*([^;,\n]+)[;,]/g);
  for (const p of propMatches) {
    if (props.length < 20 && !['string', 'number', 'boolean', 'void'].includes(p[1])) {
      props.push({ name: p[1], type: p[2].trim() });
    }
  }

  const importMatches = content.matchAll(/import\s+(?:\{([^}]+)\}|([A-Za-z0-9_$]+)|\*\s+as\s+([A-Za-z0-9_$]+))\s+from\s+['"]([^'"]+)['"]/g);
  for (const m of importMatches) {
    const sourceModule = m[4];
    if (m[1]) {
      for (const s of m[1].split(',')) {
        const trimmed = s.trim().split(/\s+as\s+/)[0].trim();
        if (trimmed) imports.push({ importedSymbol: trimmed, sourceModule, line: 1 });
      }
    } else if (m[2]) {
      imports.push({ importedSymbol: 'default', sourceModule, line: 1 });
    } else if (m[3]) {
      imports.push({ importedSymbol: '*', sourceModule, line: 1 });
    }
  }

  return { symbols, props, hooks: Array.from(hooks), imports };
};

export const extractAstMetadata = (content, filePath) => {
  if (!isBabelParsable(filePath)) {
    return extractRegexFallback(content, filePath);
  }

  const ext = path.extname(filePath);
  const code = extractParseableCode(content, ext);
  const contentLines = content.split('\n');

  const symbols = [];
  const props = [];
  const imports = [];
  const hooks = new Set();

  const resolveSignature = (startLine) => {
    const lineText = contentLines[startLine - 1] || '';
    return lineText.trim();
  };

  try {
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx']
    });

    const body = ast.program.body || [];
    for (const node of body) {
      if (node.type === 'ImportDeclaration') {
        const sourceModule = node.source?.value || '';
        const line = node.loc?.start.line || 1;
        for (const spec of node.specifiers || []) {
          if (spec.type === 'ImportSpecifier') {
            const symName = spec.imported?.name || spec.local?.name;
            imports.push({ importedSymbol: symName, sourceModule, line });
          } else if (spec.type === 'ImportDefaultSpecifier') {
            imports.push({ importedSymbol: 'default', sourceModule, line });
          } else if (spec.type === 'ImportNamespaceSpecifier') {
            imports.push({ importedSymbol: '*', sourceModule, line });
          }
        }
      } else if (node.type === 'ExportNamedDeclaration') {
        const decl = node.declaration;
        if (decl) {
          const startLine = decl.loc?.start.line || node.loc?.start.line || 1;
          const endLine = decl.loc?.end.line || node.loc?.end.line || startLine;
          const signature = resolveSignature(startLine);

          if (decl.type === 'FunctionDeclaration' && decl.id) {
            symbols.push({ name: decl.id.name, kind: 'function', isExport: true, startLine, endLine, signature });
          } else if (decl.type === 'ClassDeclaration' && decl.id) {
            symbols.push({ name: decl.id.name, kind: 'class', isExport: true, startLine, endLine, signature });
          } else if (decl.type === 'VariableDeclaration') {
            for (const v of decl.declarations) {
              if (v.id && v.id.name) {
                const varStart = v.loc?.start.line || startLine;
                const varEnd = v.loc?.end.line || endLine;
                symbols.push({ name: v.id.name, kind: 'const', isExport: true, startLine: varStart, endLine: varEnd, signature: resolveSignature(varStart) });
              }
            }
          } else if (decl.type === 'TSTypeAliasDeclaration' && decl.id) {
            symbols.push({ name: decl.id.name, kind: 'type', isExport: true, startLine, endLine, signature });
          } else if (decl.type === 'TSInterfaceDeclaration' && decl.id) {
            symbols.push({ name: decl.id.name, kind: 'interface', isExport: true, startLine, endLine, signature });
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
        const startLine = node.loc?.start.line || 1;
        const endLine = node.loc?.end.line || startLine;
        symbols.push({ name, kind: 'default', isExport: true, startLine, endLine, signature: resolveSignature(startLine) });
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

    return { symbols, props, hooks: Array.from(hooks), imports };
  } catch {
    return extractRegexFallback(content);
  }
};
