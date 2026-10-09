// Forge facets (design doc, Summary): groups form only inside one facet, so units that cannot share
// code never meet. A facet is { lang, runtime, spec, packageRoot } and its key is
// `<lang>:<runtime>:<spec|src>:<packageRoot>`.
//   lang         ts for .ts/.tsx/.mts/.cts and for a .vue file with a lang="ts" script, else js
//   runtime      vue / react / svelte from the file's own imports or extension, else plain
//   spec         a .spec/.test file, or a file under a tests or __tests__ directory
//   packageRoot  the nearest directory (root-relative) holding a package.json, '.' at the root
import fs from 'node:fs';
import path from 'node:path';

const TS_EXTENSIONS = /\.(ts|tsx|mts|cts)$/;
const SPEC_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;
const SPEC_DIRS = new Set(['tests', '__tests__']);
const VUE_TS_SCRIPT = /<script[^>]*\blang=["']ts["']/;
const FRAMEWORK_IMPORTS = [
  ['vue', /\bfrom\s+['"](vue|vuetify|pinia|vue-router)(\/[^'"]*)?['"]/],
  ['react', /\bfrom\s+['"](react|react-dom|preact)(\/[^'"]*)?['"]/],
  ['svelte', /\bfrom\s+['"]svelte(\/[^'"]*)?['"]/]
];
const EXTENSION_RUNTIMES = [['.vue', 'vue'], ['.svelte', 'svelte'], ['.jsx', 'react'], ['.tsx', 'react']];

const toPosix = (relativePath) => relativePath.replaceAll('\\', '/');

const langOf = (relativePath, content) => {
  const isTsFile = TS_EXTENSIONS.test(relativePath);
  const isTsVue = relativePath.endsWith('.vue') && VUE_TS_SCRIPT.test(content);
  return isTsFile || isTsVue ? 'ts' : 'js';
};

const runtimeOf = (relativePath, content) => {
  const imported = FRAMEWORK_IMPORTS.find(([, pattern]) => pattern.test(content));
  if (imported) return imported[0];
  const byExtension = EXTENSION_RUNTIMES.find(([extension]) => relativePath.endsWith(extension));
  return byExtension ? byExtension[1] : 'plain';
};

/** True for spec files: a .spec/.test name or a tests/__tests__ directory segment. */
export const isSpecPath = (relativePath) => {
  const segments = toPosix(relativePath).split('/');
  const isSpecName = SPEC_FILE.test(segments.at(-1) ?? '');
  return isSpecName || segments.slice(0, -1).some((segment) => SPEC_DIRS.has(segment));
};

export const facetKeyOf = (facet) => `${facet.lang}:${facet.runtime}:${facet.spec ? 'spec' : 'src'}:${facet.packageRoot}`;

/** The facet key with only its packageRoot replaced (lang, runtime and spec come from content and name). */
export const withPackageRoot = (facetKey, packageRoot) => `${facetKey.split(':').slice(0, 3).join(':')}:${packageRoot}`;

/** The packageRoot part of a facet key (a root may itself hold ':'). */
export const packageRootOfKey = (facetKey) => facetKey.split(':').slice(3).join(':');

/**
 * Facet resolver for one project root. Package roots are looked up once per directory.
 * facetOf(relativePath, content) returns { lang, runtime, spec, packageRoot, key };
 * packageRootOfFile(relativePath) resolves only the package root, from disk, without content.
 */
export const createFacetResolver = (root) => {
  const packageRoots = new Map();

  const hasManifest = (relativeDir) => fs.existsSync(path.join(root, relativeDir, 'package.json'));

  const packageRootOf = (relativeDir) => {
    const isTop = relativeDir === '.' || relativeDir === '';
    if (isTop) return '.';
    const isKnown = packageRoots.has(relativeDir);
    if (isKnown) return packageRoots.get(relativeDir);
    const resolved = hasManifest(relativeDir) ? relativeDir : packageRootOf(path.posix.dirname(relativeDir));
    packageRoots.set(relativeDir, resolved);
    return resolved;
  };

  const facetOf = (relativePath, content = '') => {
    const posixPath = toPosix(relativePath);
    const facet = {
      lang: langOf(posixPath, content),
      runtime: runtimeOf(posixPath, content),
      spec: isSpecPath(posixPath),
      packageRoot: packageRootOf(path.posix.dirname(posixPath))
    };
    return { ...facet, key: facetKeyOf(facet) };
  };

  const packageRootOfFile = (relativePath) => packageRootOf(path.posix.dirname(toPosix(relativePath)));

  return { facetOf, packageRootOfFile };
};
