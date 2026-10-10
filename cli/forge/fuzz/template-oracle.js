// Template half of the fuzz oracle (#2596): what a template renders, as a tree, plus what its event
// handlers do. Observed: element vs component identity, props, text, slot output for sample slot
// props, directives with their modifiers, and the template-context reads, writes and calls the render
// and two synthetic events (key 'Enter', then key 'a', each with preventDefault/stopPropagation spies)
// cause. Not observed, by design (engine doc section 3, Templates): class, style, key, ref and id
// (passthrough attributes Forge drops), patch flags and hoisting (compiler hints), prop order.
//   Vue: @vue/compiler-sfc compiles the SFC template; the render function runs against the real `vue`
//        runtime helpers, with resolveComponent following Vue's own name resolution over a fixed registry.
//   JSX: the module runs in the script sandbox in template mode (harness __h drops passthrough props,
//        component names are labelled globals), called as host(p) with the template props input.
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { evaluateSide, TIMEOUT_MS } from './sandbox.js';

const requireFromHere = createRequire(import.meta.url);
const PASSTHROUGH = new Set(['class', 'style', 'key', 'ref', 'id', 'className', 'ref_for', 'ref_key']);
export const COMPONENT_NAMES = Object.freeze(['Comp', 'Item', 'MyEl', 'Button', 'Foo', 'Div']);
export const TEMPLATE_PROPS = 32;
const SLOT_PROPS = Object.freeze({ a: 'A', b: 'B', item: 'I', index: 0 });
const EVENT_KEYS = ['Enter', 'a'];

let runtime = null;
const loadRuntime = () => {
  runtime = runtime ?? { vue: requireFromHere('vue'), sfc: requireFromHere('vue/compiler-sfc') };
  return runtime;
};

const createRegistry = () => Object.fromEntries(COMPONENT_NAMES.map((name) => [name, { name: `fuzz-${name}` }]));

const resolverFor = (vue, registry) => (name) => {
  const camel = vue.camelize(name);
  return registry[name] ?? registry[camel] ?? registry[vue.capitalize(camel)] ?? name;
};

const createContextProxy = (log) => {
  const target = { a: 1, b: 'two', n: 3, items: ['i', 'j'], k: 'title', v: 'val', obj: { title: 'o' } };
  target.f = (...args) => log.push(`call f(${args.length})`);
  target.g = (...args) => log.push(`call g(${args.length})`);
  return new Proxy(target, {
    get: (object, key) => {
      const isTracked = typeof key === 'string';
      if (isTracked) log.push(`get ${key}`);
      return object[key];
    },
    set: (object, key, value) => {
      log.push(`set ${String(key)}=${JSON.stringify(value)}`);
      object[key] = value;
      return true;
    },
    has: (object, key) => key in object
  });
};

const fakeEvent = (key, log) => {
  const target = { value: '5', checked: true };
  return {
    type: 'fuzz', key, target, currentTarget: target, button: 0,
    ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    preventDefault: () => log.push('preventDefault'),
    stopPropagation: () => log.push('stopPropagation')
  };
};

const createSerializer = (vue, registry, handlers) => {
  const directiveNames = new Map(Object.entries(vue).filter(([, value]) => value && typeof value === 'object').map(([name, value]) => [value, name]));
  const componentNames = new Map(Object.entries(registry).map(([name, value]) => [value, name]));
  const value = (item, depth = 0) => {
    const isHandler = typeof item === 'function';
    if (isHandler) return `handler#${handlers.push(item) - 1}`;
    const isPlain = item === null || typeof item !== 'object' || depth > 3;
    if (isPlain) return item === undefined ? 'undefined' : JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map((entry) => value(entry, depth + 1)).join(',')}]`;
    return `{${Object.keys(item).sort().map((key) => `${key}:${value(item[key], depth + 1)}`).join(',')}}`;
  };
  const TYPE_NAMES = {
    string: (type) => `<${type}>`,
    symbol: (type) => String(type.description),
    object: (type) => `component:${componentNames.get(type) ?? 'unknown'}`
  };
  const typeOf = (type) => (TYPE_NAMES[typeof type] ?? TYPE_NAMES.object)(type);
  const slots = (children) => Object.keys(children).filter((name) => name !== '_').sort()
    .map((name) => `${name}=>${node(children[name](SLOT_PROPS))}`).join(';');
  const childrenOf = (children) => {
    const isEmpty = children === null || children === undefined;
    if (isEmpty) return '';
    const isText = typeof children === 'string';
    if (isText) return JSON.stringify(children);
    const isList = Array.isArray(children);
    return isList ? children.map(node).join(',') : `slots(${slots(children)})`;
  };
  const props = (all) => Object.keys(all ?? {}).filter((key) => !PASSTHROUGH.has(key)).sort().map((key) => `${key}=${value(all[key])}`).join(' ');
  const dirs = (list) => (list ?? []).map((dir) => `${directiveNames.get(dir.dir) ?? 'dir'}(${value(dir.value)},${dir.arg ?? ''},${Object.keys(dir.modifiers ?? {}).join('.')})`).join(' ');
  function node(item) {
    if (Array.isArray(item)) return `[${item.map(node).join(',')}]`;
    const isVNode = vue.isVNode(item);
    if (!isVNode) return value(item);
    return `${typeOf(item.type)}(${props(item.props)}|${dirs(item.dirs)}){${childrenOf(item.children)}}`;
  }
  return node;
};

const fire = (handlers, log) => {
  for (const [index, handler] of handlers.entries()) {
    for (const key of EVENT_KEYS) {
      log.push(`fire handler#${index} ${key}`);
      try {
        handler(fakeEvent(key, log));
      } catch (err) {
        log.push(`handler-throw:${err?.name ?? 'value'}`);
      }
    }
  }
};

const renderModuleOf = (code) => {
  const helpers = code.replace(/^import \{([^}]*)\} from "vue"/m, (match, names) => `const {${names.replace(/ as /g, ': ')}} = __vue;`);
  return `(function (__vue) {\n${helpers.replace('export function render', 'function render')}\nreturn render;\n})`;
};

/** Events of a Vue SFC side: the compiled template rendered once, then its handlers fired. */
export const evaluateVueSide = (side, { timeoutMs }) => {
  const { vue, sfc } = loadRuntime();
  const filename = side.entry;
  const { descriptor, errors } = sfc.parse(side.files[filename], { filename });
  const source = descriptor.template?.content ?? '';
  const compiled = errors.length > 0 ? { errors } : sfc.compileTemplate({ source, filename, id: 'fuzz' });
  const hasErrors = compiled.errors.length > 0;
  if (hasErrors) return ['compile-error'];
  const registry = createRegistry();
  const helpers = { ...vue, resolveComponent: resolverFor(vue, registry), resolveDirective: () => undefined, withDirectives: (vnode, dirs) => Object.assign(vnode, { dirs: dirs.map(([dir, value, arg, modifiers]) => ({ dir, value, arg, modifiers })) }) };
  const log = [];
  const handlers = [];
  try {
    const render = vm.runInNewContext(renderModuleOf(compiled.code), {}, { timeout: timeoutMs })(helpers);
    const tree = createSerializer(vue, registry, handlers)(render(createContextProxy(log), []));
    log.push(`tree:${tree}`);
  } catch (err) {
    return [...log, `render-throw:${err?.name ?? 'value'}`];
  }
  fire(handlers, log);
  return log;
};

/** Events of a JSX side: host(p) in the script sandbox, template mode. */
export const evaluateJsxSide = (side, options) => evaluateSide({ ...side, mode: 'module', invoke: '(mod.__fuzzHost ?? mod.host)(args[0])', template: COMPONENT_NAMES }, [TEMPLATE_PROPS], options);

/** Events of a template side; options.timeoutMs bounds the render (sandbox.js TIMEOUT_MS by default). */
export const evaluateTemplateSide = (side, { timeoutMs = TIMEOUT_MS } = {}) => (side.entry.endsWith('.vue') ? evaluateVueSide(side, { timeoutMs }) : evaluateJsxSide(side, { timeoutMs }));
