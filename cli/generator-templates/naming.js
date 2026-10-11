// A capsule name becomes a directory, file names and identifiers, so it is a lowercase slug:
// letters and digits, single hyphens between parts. Anything else (a path, a space, an accent)
// is refused here instead of being half-sanitised into the folder name and left raw elsewhere.
const CAPSULE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const describeCapsuleNameError = (name) => {
  const isSlug = CAPSULE_NAME.test(name);
  if (isSlug) return null;
  return `Invalid capsule name "${name}": use lowercase letters, digits and single hyphens (for example user-avatar or m-spark-kpi).`;
};

export const assertValidCapsuleName = (name) => {
  const error = describeCapsuleNameError(name);
  if (error) throw new Error(error);
};

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
