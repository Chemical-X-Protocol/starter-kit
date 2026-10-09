export const toPascalCase = (str) =>
  str
    .replace(/^(?:[a-z]|use|v)-/, '')
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');

export const toCamelCase = (str) => {
  const p = toPascalCase(str);
  const isUseName = str.startsWith('use-') || str.startsWith('use');
  if (isUseName) {
    return `use${p}`;
  }
  return p.charAt(0).toLowerCase() + p.slice(1);
};
