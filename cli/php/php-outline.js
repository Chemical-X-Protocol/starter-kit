// Outline for PHP files with line ranges on every declaration (design spec section 6).
// Under-promise: it lists declarations the php-parser tree reports; it does not list call
// sites, hook closures or WordPress registrations.

import { extractPhpSymbols } from './php-symbols.js';

const NOTES = {
  partial: '// Partial outline: the file has syntax errors, so declarations after the error may be missing.',
  error: '// No declarations listed: the file did not parse as PHP.',
  minified: '// No declarations listed: the file looks minified.',
  unavailable: '// No declarations listed: the php-parser package could not be loaded.',
};

function range(sym) {
  const isSingleLine = sym.endLine <= sym.startLine;
  return isSingleLine ? `L${sym.startLine}` : `L${sym.startLine}-${sym.endLine}`;
}

function modifiers(sym) {
  const hidesPublic = sym.kind === 'const' && sym.visibility === 'public';
  return [sym.isAbstract ? 'abstract' : '', hidesPublic ? '' : sym.visibility, sym.isStatic ? 'static' : ''].filter(Boolean);
}

const MEMBER_TEXT = {
  method: (sym) => [...modifiers(sym), `function ${sym.signature.slice(sym.container.length + 2)}`].join(' '),
  property: (sym) => [...modifiers(sym), `$${sym.name}`].join(' '),
  const: (sym) => [...modifiers(sym), `const ${sym.name}`].join(' '),
  use: (sym) => sym.signature,
  case: (sym) => `case ${sym.name}`,
};

function lineFor(sym) {
  const topLevelText = sym.kind === 'function' ? `function ${sym.signature}` : sym.signature;
  const text = sym.isMember ? MEMBER_TEXT[sym.kind](sym) : topLevelText;
  return `${sym.isMember ? '  ' : ''}${range(sym)}  ${text}`;
}

export function generatePhpOutline(content, filePath) {
  const { symbols, status } = extractPhpSymbols(content, filePath);
  const note = NOTES[status];
  return [`// Outline: ${filePath}`, ...(note ? [note] : []), ...symbols.map(lineFor)].join('\n');
}
