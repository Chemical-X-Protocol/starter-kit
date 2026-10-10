// Main-realm half of the fuzz oracle (#2596): evaluates one side of a generated pair in a fresh vm
// context per input vector and returns the event list the harness recorded (harness.js). Code is
// generated test code only, never project input. Each module of the side is compiled with
// vm.compileFunction as a CommonJS-shaped function (exports, require, module, __filename, __dirname,
// __importMeta); TS, JSX and import syntax go through transpile.js first. Module resolution follows the
// TS bundler model (resolve.js), so './x.js' finds x.ts and a missing file is a thrown Error.
// The context runs its microtasks after each evaluation (microtaskMode 'afterEvaluate'), so async
// results settle inside the evaluation and its timeout; an empty context has no timers.
import vm from 'node:vm';
import { installHarness } from './harness.js';
import { compileModule } from './transpile.js';
import { resolveSpecifier } from './resolve.js';

const HARNESS_SCRIPT = new vm.Script(`(${installHarness.toString()})(globalThis);`, { filename: 'fuzz-harness.js' });
export const TIMEOUT_MS = 250;
const isTimeout = (err) => err?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
const WRAPPER_PARAMS = ['exports', 'require', 'module', '__filename', '__dirname', '__importMeta'];
const HOST_EXPORT = '\n;try { exports.__fuzzHost = typeof host === "undefined" ? undefined : host; } catch (err) { /* TDZ */ }';
const DEFAULT_INVOKE = '(mod.__fuzzHost ?? mod.host)(...args)';

const LOADER_SCRIPT_SOURCE = `(function (compiled, resolve, isScript) {
  const cache = new Map();
  const stubs = new Map();
  const stubOf = (id) => {
    if (!stubs.has(id)) stubs.set(id, Object.freeze({ __stub: id, createRequire: (url) => requireFrom(String(url).replace('file:///', '')) }));
    return stubs.get(id);
  };
  const load = (path) => {
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} };
    cache.set(path, module);
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
    const meta = { url: 'file:///' + path, resolve: (spec) => 'file:///' + resolve(path, spec) };
    compiled[path].call(isScript ? module.exports : undefined, module.exports, requireFrom(path), module, path, dir, meta);
    return module.exports;
  };
  function requireFrom(from) {
    const req = (spec) => {
      const target = resolve(from, String(spec));
      if (target === null) throw new Error('Cannot find module ' + spec);
      return target.startsWith('stub:') ? stubOf(target) : load(target);
    };
    req.resolve = (spec) => resolve(from, String(spec));
    return req;
  }
  return { load };
})`;
const scripts = new Map();
const scriptOf = (source) => {
  const isNew = !scripts.has(source);
  if (isNew) scripts.set(source, new vm.Script(source));
  return scripts.get(source);
};

const compileAll = (side, context) => {
  const compiled = {};
  for (const [path, code] of Object.entries(side.files)) {
    const js = compileModule(path, code, { mode: side.mode });
    const body = path === side.entry ? `${js}${HOST_EXPORT}` : js;
    compiled[path] = vm.compileFunction(body, WRAPPER_PARAMS, { parsingContext: context, filename: path });
  }
  return compiled;
};

const typeOf = (context, err) => (context.__fuzzErrorType ? context.__fuzzErrorType(err) : 'unknown');

/** Runs `source` (an expression of the given globals) in the context under the timeout; scripts are compiled once. */
const runIn = (context, source, globals, timeout) => {
  Object.assign(context, globals);
  return scriptOf(source).runInContext(context, { timeout });
};

/**
 * Evaluates one side for one input vector. side: { files: {path: code}, entry, mode: 'module'|'script',
 * invoke?, template? } where invoke is an expression over `mod` (the entry's exports) and `args`, and
 * template (component names) turns on the harness template mode (see template-oracle.js).
 * inputSpec: pool indices (harness POOL, -1 for the probe). options.timeoutMs bounds each evaluation.
 * Returns the event list (strings); 'timeout' marks a run cut off by the timeout (pair-check.js retries).
 */
export const evaluateSide = (side, inputSpec, { timeoutMs = TIMEOUT_MS } = {}) => {
  const context = vm.createContext({}, { microtaskMode: 'afterEvaluate' });
  HARNESS_SCRIPT.runInContext(context);
  let compiled;
  try {
    compiled = compileAll(side, context);
  } catch (err) {
    return [`compile-throw:${err?.name ?? 'Error'}`];
  }
  const resolve = (from, spec) => resolveSpecifier(from, spec, side.files);
  let mod;
  try {
    const loader = runIn(context, LOADER_SCRIPT_SOURCE, {}, timeoutMs)(compiled, resolve, side.mode === 'script');
    const isTemplate = Boolean(side.template);
    if (isTemplate) context.__fuzzTemplate(side.template);
    mod = runIn(context, '__fuzzLoader.load(__fuzzEntry)', { __fuzzLoader: loader, __fuzzEntry: side.entry }, timeoutMs);
  } catch (err) {
    return [isTimeout(err) ? 'timeout' : `load-throw:${typeOf(context, err)}`];
  }
  try {
    const invoke = `__fuzzRun(__fuzzSpec, (args) => { const mod = __fuzzMod; return ${side.invoke ?? DEFAULT_INVOKE}; })`;
    runIn(context, invoke, { __fuzzSpec: inputSpec, __fuzzMod: mod }, timeoutMs);
  } catch (err) {
    return [...context.__fuzzEvents, isTimeout(err) ? 'timeout' : `run-throw:${typeOf(context, err)}`];
  }
  const events = [...context.__fuzzEvents];
  return context.__fuzzDone ? events : [...events, 'pending'];
};
