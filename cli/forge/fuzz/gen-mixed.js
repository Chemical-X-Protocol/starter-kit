// Random-program mutation fuzzing (#2596): a small statement and expression grammar over the host's
// params and a few locals, where every production is a mutation site with a list of alternative
// spellings (sound normalizations and near misses). A program is generated twice from the same choices:
// the left side prints every site normally, the right side prints exactly one site (the target) with
// its chosen alternative, so the pair differs by one rewrite inside arbitrary surrounding code.
import { bodyPair } from './gen-kit.js';

/** An alternative that swaps two same-shape parts: they may differ only in names or literals, an L2 merge by design. */
const swap = (make) => Object.assign(make, { isSwap: true });

const LEAVES = ['a', 'b', 'c', 'd', '0', '1', "''", "'x'", 'null', 'undefined', 'f(1)', 'f(2)', 'a.x', 'b.y', 'NaN'];
const MAX_LOCALS = 4;

/**
 * Generation state for one rendering. target: the site index printed mutated (-1: none).
 * site(normal, alternatives) consumes one choice (which alternative) whether or not it is the target,
 * so both renderings consume the same choices and stay aligned.
 */
const createState = (g, target) => {
  let siteCount = 0;
  const locals = [];
  const renamed = new Map();
  const flags = { isAbstract: false };
  const site = (normal, alternatives) => {
    const index = siteCount;
    siteCount += 1;
    const choice = g.int(alternatives.length + 1);
    const isMutated = index === target && choice > 0;
    if (!isMutated) return normal();
    const alternative = alternatives[choice - 1];
    flags.isAbstract = alternative.isSwap === true;
    return alternative();
  };
  const nameOf = (local) => renamed.get(local) ?? local;
  return { g, site, locals, renamed, nameOf, sites: () => siteCount, isAbstract: () => flags.isAbstract };
};

const leaf = (state) => {
  const { g, locals } = state;
  const useLocal = locals.length > 0 && g.int(3) === 1;
  return useLocal ? state.nameOf(g.pick(locals)) : g.pick(LEAVES);
};

const EXPRESSIONS = [
  (s, sub) => {
    const [l, r] = [sub(), sub()];
    const op = s.g.pick(['===', '!==', '==', '!=', '<', '+', '-', '&']);
    const negated = op === '!==' ? '===' : '!==';
    const weakened = op === '===' ? '==' : '===';
    return s.site(() => `(${l} ${op} ${r})`, [
      swap(() => `(${r} ${op} ${l})`),
      () => `!(${l} ${negated} ${r})`,
      () => `(${r} > ${l})`,
      () => `(${l} ${weakened} ${r})`
    ]);
  },
  (s, sub) => {
    const [l, r] = [sub(), sub()];
    const op = s.g.pick(['&&', '||', '??']);
    const dual = op === '&&' ? '||' : '&&';
    return s.site(() => `(${l} ${op} ${r})`, [
      swap(() => `(${r} ${op} ${l})`),
      () => `(${l} ${dual} ${r})`,
      () => `!(!${l} ${dual} !${r})`,
      () => `(Boolean(${l}) ${op} ${r})`
    ]);
  },
  (s, sub) => {
    const x = sub();
    return s.site(() => `!${x}`, [() => `!Boolean(${x})`, () => `!!${x}`, () => x]);
  },
  (s, sub) => {
    const [t, y, n] = [sub(), sub(), sub()];
    return s.site(() => `(${t} ? ${y} : ${n})`, [() => `(!${t} ? ${n} : ${y})`, () => `(Boolean(${t}) ? ${y} : ${n})`, swap(() => `(${t} ? ${n} : ${y})`)]);
  },
  (s, sub) => {
    const x = sub();
    return s.site(() => `f(${x})`, [() => `f(...[${x}])`, () => `f?.(${x})`, () => `(0, f)(${x})`]);
  },
  (s, sub) => {
    const x = sub();
    return s.site(() => `${x}?.x`, [() => `${x}.x`, () => `${x}?.['x']`, () => `(${x}?.x)`]);
  },
  (s, sub) => {
    const [x, y] = [sub(), sub()];
    return s.site(() => `[${x}, ${y}]`, [() => `[${x}, , ${y}]`, () => `[${x}, ${y},]`, swap(() => `[${y}, ${x}]`), () => `[...[${x}], ${y}]`]);
  },
  (s, sub) => {
    const [x, y] = [sub(), sub()];
    return s.site(() => `({ x: ${x}, y: ${y} })`, [swap(() => `({ y: ${y}, x: ${x} })`), () => `({ 'x': ${x}, y: ${y} })`, () => `({ ['x']: ${x}, y: ${y} })`, () => `({ __proto__: ${x}, y: ${y} })`]);
  },
  (s, sub) => {
    const x = sub();
    return s.site(() => `\`<\${${x}}>\``, [() => `('<' + ${x} + '>')`, () => `\`<\${String(${x})}>\``]);
  },
  (s, sub) => {
    const x = sub();
    return s.site(() => `(() => ${x})()`, [() => `(() => { return ${x}; })()`, () => `(function () { return ${x}; })()`, () => `(() => { ${x}; })()`]);
  }
];

const expression = (state, depth) => {
  const isLeaf = depth <= 0 || state.g.int(3) === 0;
  if (isLeaf) return leaf(state);
  return state.g.pick(EXPRESSIONS)(state, () => expression(state, depth - 1));
};

const declare = (state) => {
  const name = `v${state.locals.length}`;
  const init = expression(state, 2);
  const kind = state.g.pick(['const', 'let', 'var']);
  const renameTo = state.g.pick(['w', 'a', 'f', 'v0', 'undefined']);
  const text = state.site(() => `${kind} ${name} = ${init};`, [
    () => `${kind === 'const' ? 'let' : 'const'} ${name} = ${init};`,
    () => `let ${name}; ${name} = ${init};`,
    () => {
      state.renamed.set(name, renameTo === 'w' ? `w${state.locals.length}` : renameTo);
      return `${kind} ${state.nameOf(name)} = ${init};`;
    }
  ]);
  state.locals.push(name);
  return text;
};

const STATEMENTS = [
  declare,
  (s) => {
    const [t, x, y] = [expression(s, 2), expression(s, 1), expression(s, 1)];
    return s.site(() => `if (${t}) { f(${x}); } else { f(${y}); }`, [
      () => `if (${t}) f(${x}); else f(${y});`,
      () => `if (!${t}) { f(${y}); } else { f(${x}); }`,
      () => `if (Boolean(${t})) { f(${x}); } else { f(${y}); }`,
      () => `if (${t}) { f(${x}); } f(${y});`
    ]);
  },
  (s) => {
    const x = expression(s, 2);
    return s.site(() => `f(${x});`, [() => `void f(${x});`, () => `(f(${x}));`]);
  },
  (s) => {
    const [d, x] = [expression(s, 1), expression(s, 1)];
    return s.site(() => `switch (${d}) { case 1: f(${x}); break; default: f(0); }`, [
      () => `switch (${d}) { case 1: f(${x}); default: f(0); }`,
      swap(() => `switch (${d}) { default: f(0); break; case 1: f(${x}); }`),
      () => `switch (${d}) { case 1: { f(${x}); break; } default: f(0); }`
    ]);
  },
  (s) => {
    const x = expression(s, 2);
    return s.site(() => `try { f(${x}); } catch (err) { f('c'); }`, [
      () => `try { f(${x}); } catch { f('c'); }`,
      () => `try { f(${x}); } finally { f('c'); }`,
      () => `f(${x});`
    ]);
  },
  (s) => {
    const [x, y] = [expression(s, 1), expression(s, 1)];
    return s.site(() => `for (const item of [${x}, ${y}]) { f(item); }`, [
      () => `for (const item of [${x}, ${y}]) f(item);`,
      () => `for (let item of [${x}, ${y}]) { f(item); }`,
      () => `for (const item in [${x}, ${y}]) { f(item); }`
    ]);
  },
  (s) => {
    const x = expression(s, 1);
    const name = `v${s.locals.length}`;
    const text = s.site(() => `const { x: ${name} = ${x} } = a ?? {};`, [
      () => `const { x: ${name} } = a ?? {};`,
      () => `const ${name} = (a ?? {}).x ?? ${x};`,
      () => `const [${name} = ${x}] = [a?.x];`
    ]);
    s.locals.push(name);
    return text;
  }
];

const render = (g, target) => {
  const state = createState(g, target);
  const count = 1 + g.int(4);
  const statements = [];
  for (let index = 0; index < count; index += 1) {
    const canDeclare = state.locals.length < MAX_LOCALS;
    const production = canDeclare ? g.pick(STATEMENTS) : g.pick(STATEMENTS.slice(1));
    statements.push(production(state));
  }
  const result = expression(state, 2);
  statements.push(`return [${[...state.locals.map(state.nameOf), result].join(', ')}];`);
  return { text: statements.join(' '), sites: state.sites(), isAbstract: state.isAbstract() };
};

/** One mixed pair: the target site is chosen after a first rendering counts the sites. */
export const mixedClass = (g) => {
  const target = g.int(64);
  const replayStart = g.recorded().length;
  const probe = render(g, -1);
  const used = g.recorded().slice(replayStart);
  const site = target % Math.max(1, probe.sites);
  const replayChoices = (base) => {
    let index = 0;
    return { ...base, int: (n) => Math.min(used[index++] ?? 0, Math.max(1, n) - 1), pick: (items) => items[Math.min(used[index++] ?? 0, items.length - 1)] };
  };
  const right = render(replayChoices(g), site);
  return { rewrite: 'one-site', site, ...bodyPair(probe.text, right.text, { abstracts: right.isAbstract }) };
};
