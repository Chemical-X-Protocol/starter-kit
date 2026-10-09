/**
 * Stylesheet outline (SCSS, Sass, Less, CSS): @mixin, @function, top-level $variables
 * and top-level selectors or at-rule blocks. CSS function calls such as var() or
 * rgba() are never reported as declarations.
 */
const STYLE_EXTENSIONS = /\.(?:scss|sass|less|css)$/i;
const DECLARATION_AT_RULE = /^@(mixin|function)\s+([\w-]+)\s*(\([^)]*\))?/;
const VARIABLE_DECLARATION = /^([$@][\w-]+)\s*:/;

export const isStylesheetFile = (filePath = '') => STYLE_EXTENSIONS.test(filePath);

const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/.*$/gm, '$1');

const describeTopLevel = (text) => {
  const declaration = DECLARATION_AT_RULE.exec(text);
  if (declaration) return `@${declaration[1]} ${declaration[2]}${declaration[3] || ''}`;
  const variable = VARIABLE_DECLARATION.exec(text);
  if (variable) return `var ${variable[1]}`;
  const isBlockOpener = text.endsWith('{');
  if (isBlockOpener) return `selector ${text.slice(0, -1).trim()}`;
  const isImport = /^@(use|forward|import)\b/.test(text);
  return isImport ? text.replace(/;$/, '') : null;
};

/** Outline lines for a stylesheet, one per top-level declaration. */
export const outlineStylesheet = (code) => {
  const lines = [];
  let depth = 0;
  for (const rawLine of stripComments(code).split('\n')) {
    const text = rawLine.trim();
    const isTopLevel = depth === 0 && text.length > 0;
    const described = isTopLevel ? describeTopLevel(text) : null;
    if (described) lines.push(described);
    for (const ch of text) {
      if (ch === '{') depth += 1;
      if (ch === '}') depth = Math.max(0, depth - 1);
    }
  }
  return lines;
};
