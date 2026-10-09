// Members of a group whose LGG has no holes (N1 groups): what the piece must take and where the members
// disagree. Text-level and conservative: a name is a parameter when the home member reads it and no import
// or module-level declaration of its file binds it. A member that is the negation of the home member is a
// polarity difference, reported as behaviorDelta and a variant hole, never merged silently.
import { byCodePoint } from './group-shape.js';

const KEYWORDS = new Set(['await', 'break', 'case', 'catch', 'const', 'continue', 'default', 'delete', 'do', 'else', 'export', 'false', 'finally', 'for', 'function', 'if', 'in', 'instanceof', 'let', 'new', 'null', 'of', 'return', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'void', 'while', 'yield', 'async']);
const IDENTIFIER_G = /(?<![\w$.])[A-Za-z_$][\w$]*/g;

const withoutLiterals = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');

const moduleBindingsOf = (fileText) => {
  const names = new Set();
  for (const match of fileText.matchAll(/^import\s+([^;]+?)\s+from\s+['"]/gm)) {
    for (const part of match[1].replace(/[{}*]/g, ',').split(',')) {
      const binding = part.trim().split(/\s+as\s+/).pop().trim();
      const isBinding = binding !== '' && binding !== 'type';
      if (isBinding) names.add(binding);
    }
  }
  for (const match of fileText.matchAll(/^(?:export\s+)?(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(match[1]);
  return names;
};

const localsOf = (code) => {
  const names = new Set();
  for (const match of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of code.matchAll(/\(([^()]*)\)\s*=>|\b([A-Za-z_$][\w$]*)\s*=>/g)) {
    for (const name of (match[1] ?? match[2]).split(',')) names.add(name.trim().replace(/^\.\.\./, '').split('=')[0].trim());
  }
  return names;
};

/** Names the member text reads but does not bind (module bindings, globals and its own locals excluded), in first-read order. */
export const freeNamesOf = (text, fileText = '') => {
  const code = withoutLiterals(text);
  const bound = new Set([...moduleBindingsOf(fileText), ...localsOf(code)]);
  const names = [];
  for (const [name] of code.matchAll(IDENTIFIER_G)) {
    const isFree = !KEYWORDS.has(name) && !bound.has(name) && !(name in globalThis) && !names.includes(name);
    const afterKey = new RegExp(`[{,]\\s*${name.replace(/\$/g, '\\$')}\\s*:`).test(code);
    const isParam = isFree && !afterKey;
    if (isParam) names.push(name);
  }
  return names;
};

/** 'negated' when the member expression is a leading `!` form (or a chain of them), else 'plain'. */
export const polarityOf = (text) => (/^\s*\(*\s*!/.test(text) ? 'negated' : 'plain');

const sliceOf = (instance, context) => {
  const fileText = context.readFile(instance.file) ?? '';
  const hasOffsets = Number.isInteger(instance.start) && Number.isInteger(instance.end) && instance.end > instance.start;
  return { fileText, text: hasOffsets ? fileText.slice(instance.start, instance.end) : '' };
};

/**
 * { params, sites, polarity, behaviorDelta } for ordered instances (the first is the home member).
 * sites: per instance { names (its own free names), polarity }. polarity: { plain: [at], negated: [at] },
 * behaviorDelta lists the members whose polarity differs from the majority (ties keep plain).
 */
export const deriveMembers = (instances, context) => {
  const sites = instances.map((instance) => {
    const { fileText, text } = sliceOf(instance, context);
    return { at: `${instance.file}:${instance.startLine}-${instance.endLine}`, names: freeNamesOf(text, fileText), polarity: text ? polarityOf(text) : 'plain' };
  });
  const home = sites[0]?.names ?? [];
  const params = home.map((name) => ({ name, kind: 'value', type: null, source: 'home-member-free-variable' }));
  const polarity = { plain: [], negated: [] };
  for (const site of sites) polarity[site.polarity].push(site.at);
  polarity.plain.sort(byCodePoint);
  polarity.negated.sort(byCodePoint);
  const majority = polarity.negated.length > polarity.plain.length ? 'negated' : 'plain';
  const minority = majority === 'plain' ? 'negated' : 'plain';
  const behaviorDelta = polarity[minority].length > 0 && polarity[majority].length > 0
    ? polarity[minority].map((at) => ({ at, kind: 'polarity', detail: `member is the ${minority === 'negated' ? 'negation' : 'complement'} of the ${majority} members; calling the piece there needs a leading !` }))
    : [];
  return { params, sites, polarity, majority, behaviorDelta };
};
