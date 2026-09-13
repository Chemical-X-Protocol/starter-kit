const TS_PATTERN_PARENS = /^([^(]+)\((\d+),(\d+)\):\s*(error|warning)\s*(TS\d+):\s*(.+)$/;
const TS_PATTERN_COLONS = /^([^:]+):(\d+):(\d+)\s*-\s*(error|warning)\s*(TS\d+):\s*(.+)$/;
const ROLLUP_RESOLVE_PATTERN = /Could not resolve ["']([^"']+)["'] from ["']([^"']+)["']/;
const VITE_ERROR_PATTERN = /\[(vite|rollup|plugin:[^\]]+)\]\s*(.+)/;
const MODULE_NOT_FOUND_PATTERN = /Module not found:\s*Can['’]t resolve ['"]([^'"]+)['"] in ['"]([^'"]+)['"]/;
const SASS_POSTCSS_PATTERN = /(CssSyntaxError|SassError):\s*(.+)/;

const resolveTsSuggestion = (code) => {
  if (code === 'TS2304' || code === 'TS2552') {
    return 'Ensure the identifier is imported or declared in scope.';
  }
  if (code === 'TS2307') {
    return 'Verify package installation or check tsconfig path aliases.';
  }
  if (code === 'TS2322' || code === 'TS2345') {
    return 'Check property types or update interface declarations.';
  }
  if (code === 'TS2339') {
    return 'Verify property naming or extend type definition.';
  }
  return 'Review TypeScript compiler diagnostic.';
};

export const matchTypeScriptError = (line) => {
  const parensMatch = line.match(TS_PATTERN_PARENS);
  if (parensMatch) {
    const [, file, lineNum, colNum, severityStr, code, message] = parensMatch;
    const severity = severityStr.toLowerCase() === 'warning' ? 'WARNING' : 'ERROR';
    return {
      category: 'TYPE_ERROR',
      severity,
      file: file.trim(),
      line: parseInt(lineNum, 10),
      column: parseInt(colNum, 10),
      code,
      message: message.trim(),
      suggestion: resolveTsSuggestion(code)
    };
  }

  const colonsMatch = line.match(TS_PATTERN_COLONS);
  if (colonsMatch) {
    const [, file, lineNum, colNum, severityStr, code, message] = colonsMatch;
    const severity = severityStr.toLowerCase() === 'warning' ? 'WARNING' : 'ERROR';
    return {
      category: 'TYPE_ERROR',
      severity,
      file: file.trim(),
      line: parseInt(lineNum, 10),
      column: parseInt(colNum, 10),
      code,
      message: message.trim(),
      suggestion: resolveTsSuggestion(code)
    };
  }

  return null;
};

export const matchResolveError = (line) => {
  const rollupMatch = line.match(ROLLUP_RESOLVE_PATTERN);
  if (rollupMatch) {
    const [, moduleName, importer] = rollupMatch;
    return {
      category: 'RESOLVE_ERROR',
      severity: 'ERROR',
      file: importer.trim(),
      code: 'MODULE_NOT_FOUND',
      message: `Could not resolve module "${moduleName}"`,
      suggestion: 'Verify import path alias, file extension, or run package install.'
    };
  }

  const moduleMatch = line.match(MODULE_NOT_FOUND_PATTERN);
  if (moduleMatch) {
    const [, moduleName, importer] = moduleMatch;
    return {
      category: 'RESOLVE_ERROR',
      severity: 'ERROR',
      file: importer.trim(),
      code: 'MODULE_NOT_FOUND',
      message: `Can't resolve "${moduleName}"`,
      suggestion: 'Verify dependency is listed in package.json and installed.'
    };
  }

  return null;
};

export const matchBundlerOrStyleError = (line) => {
  const sassMatch = line.match(SASS_POSTCSS_PATTERN);
  if (sassMatch) {
    const [, errorType, message] = sassMatch;
    return {
      category: 'STYLE_ERROR',
      severity: 'ERROR',
      code: errorType,
      message: message.trim(),
      suggestion: 'Check stylesheet syntax, missing variable, or mixin import.'
    };
  }

  const viteMatch = line.match(VITE_ERROR_PATTERN);
  if (viteMatch) {
    const [, plugin, message] = viteMatch;
    return {
      category: 'SYNTAX_ERROR',
      severity: 'ERROR',
      code: plugin,
      message: message.trim(),
      suggestion: 'Check component template syntax or plugin configuration.'
    };
  }

  return null;
};
