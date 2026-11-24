/**
 * ATOM_BYPASS_CONTROL: UI controls that bypass the project's atoms (a raw <button>, a
 * button-styled <a>, a framework button such as <v-btn>) outside the atom directories.
 * Opt-in: the rule only runs when the project config has an `atoms` object (.chemxrc).
 *   atoms: { dirs: [...], replacements: { button, 'link-button', 'v-btn' }, frameworkButtons: [...] }
 */
import path from 'node:path';
import { RULE_REGISTRY } from './rules-registry.js';
import { isTemplateExtension } from './rules-predicates.js';
import { parseSfc } from '../sfc/sfc-parse.js';

export const DEFAULT_ATOM_DIRS = ['src/components/primitives', 'src/components/atoms', 'atoms'];
export const DEFAULT_FRAMEWORK_BUTTONS = ['v-btn', 'VBtn', 'el-button', 'ElButton', 'b-button'];
const DEFAULT_REPLACEMENTS = { button: 'AtomButton', 'link-button': 'AtomButton', 'v-btn': 'AtomButton' };

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const stringList = (value, fallback) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v) : fallback);

/** The `atoms` config reduced to valid entries with defaults; null when the project did not opt in. */
export const normalizeAtomsConfig = (raw) => {
  if (!isPlainObject(raw)) return null;
  const replacements = { ...DEFAULT_REPLACEMENTS };
  const given = Object.entries(isPlainObject(raw.replacements) ? raw.replacements : {});
  const valid = given.filter(([, value]) => typeof value === 'string' && value);
  Object.assign(replacements, Object.fromEntries(valid));
  return {
    dirs: stringList(raw.dirs, DEFAULT_ATOM_DIRS),
    replacements,
    frameworkButtons: stringList(raw.frameworkButtons, DEFAULT_FRAMEWORK_BUTTONS)
  };
};

const toPosix = (p) => p.split('\\').join('/');

const isInsideAtomDir = (relativePath, dirs) => {
  const normalized = toPosix(relativePath);
  return dirs.some((dir) => {
    const clean = toPosix(dir).replace(/^\.\//, '').replace(/\/+$/, '');
    return normalized.startsWith(`${clean}/`) || normalized.includes(`/${clean}/`);
  });
};

const blankComments = (text) => text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));

const TAG_PATTERN = /<([A-Za-z][\w-]*)(?=[\s/>])((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

const classifyLink = (attrs) => {
  const hasHref = /(?:^|\s):?(?:href|to)\s*=|(?:^|\s)v-bind:href\s*=/.test(attrs);
  const hasButtonRole = /\brole\s*=\s*["']button["']/.test(attrs);
  const classMatch = attrs.match(/(?:^|\s):?class\s*=\s*(?:"([^"]*)"|'([^']*)')/);
  const classText = classMatch ? classMatch[1] ?? classMatch[2] ?? '' : '';
  const hasButtonClass = /(?:^|[^\w-])(?:btn|button)(?![\w-])/.test(classText);
  const hasClick = /(?:^|\s)(?:@click|v-on:click)\b/.test(attrs);
  return hasButtonRole || hasButtonClass || (hasClick && !hasHref);
};

const classifyTag = (name, attrs, atoms) => {
  const { replacements, frameworkButtons } = atoms;
  const isRawButton = name === 'button';
  const isButtonLink = name === 'a' && classifyLink(attrs);
  const isFrameworkButton = frameworkButtons.includes(name);
  const found = [
    [isRawButton, 'raw <button>', replacements.button],
    [isButtonLink, 'a button-styled <a>', replacements['link-button'] ?? replacements.button],
    [isFrameworkButton, `framework <${name}>`, replacements['v-btn'] ?? replacements.button]
  ].find(([matches]) => matches);
  return found ? { kind: found[1], atom: found[2] } : null;
};

const templateRegion = (content, filePath, ext) => {
  const isVue = ext === '.vue';
  const template = isVue ? parseSfc(content, filePath).template : null;
  const wholeFile = { text: content, lineOffset: 0 };
  const vueRegion = template ? { text: template.content, lineOffset: template.startLine - 1 } : null;
  return isVue ? vueRegion : wholeFile;
};

export const checkAtomBypassControl = (content, filePath, relativePath, violations, atomsRaw) => {
  const atoms = normalizeAtomsConfig(atomsRaw);
  const ext = path.extname(filePath);
  const isApplicable = Boolean(atoms) && (isTemplateExtension(ext) || ext === '.tsx' || ext === '.jsx');
  const isSkipped = !isApplicable || isInsideAtomDir(relativePath, atoms.dirs);
  const region = isSkipped ? null : templateRegion(content, filePath, ext);
  const text = region ? blankComments(region.text) : '';
  const meta = RULE_REGISTRY.ATOM_BYPASS_CONTROL;
  const hits = [...text.matchAll(TAG_PATTERN)]
    .map((match) => ({ match, found: classifyTag(match[1], match[2], atoms) }))
    .filter(({ found }) => found);
  for (const { match, found } of hits) {
    violations.push({
      filePath: relativePath,
      line: region.lineOffset + lineAt(text, match.index),
      column: 1,
      hazard: `UI control bypasses the project atom: ${found.kind}`,
      rule: 'ATOM_BYPASS_CONTROL',
      severity: meta.severity,
      pillar: meta.pillar,
      directive: `Use <${found.atom}> (atom) instead of ${found.kind}`
    });
  }
};
