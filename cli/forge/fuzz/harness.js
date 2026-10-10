// In-sandbox half of the fuzz oracle (#2596). `installHarness` is never called in this realm: the
// sandbox evaluates its source text inside a fresh vm context, so every value it builds (inputs, logs,
// serialized results) belongs to that context's own intrinsics. It must stay self-contained (no
// closures over module scope, no imports).
//
// Observation model: one ordered event list per run. Inputs record what user code does to them
// (getter reads, ToPrimitive hints, iterator steps, proxy traps, calls); the run appends its outcome
// (`ret:` or `throw:`) and, for a generator, iterator or promise result, the steps of draining it.
// Error messages are never observed (they quote binder names, which L1 renames by design), only the
// error's intrinsic type. Function names and source text are not observed either (see the engine doc).
export const POOL_LABELS = Object.freeze([
  'undefined', 'null', '0', '1', '-0', 'NaN', "''", "'x'", "'0'", 'true', 'false', '2n', "Symbol('s')",
  '{}', '[]', '[1, 2]', '{ x: 1, y: 2 }', 'getter object', 'toPrimitive object', 'valueOf/toString object',
  'logging iterable', 'logging proxy', 'throwing getter object', 'logging function', 'null-prototype object',
  'frozen object', 'thenable', "'string'", '[1, , 3]', '{ x: undefined }', "'Enter'", '-1', 'template props'
]);

export const PROBE = -1;

export function installHarness(global) {
  const events = [];
  const state = { isQuiet: false };
  const rec = (text) => {
    if (!state.isQuiet) events.push(`log:${text}`);
  };
  const keyText = (key) => (typeof key === 'symbol' ? `@${key.description}` : String(key));
  const inputs = new Map();
  const makeProxy = () => {
    const target = { x: 1, y: 2, length: 2, 0: 'a', 1: 'b' };
    const trap = (name) => (...args) => {
      const key = args[1];
      const shown = name === 'ownKeys' || name === 'getPrototypeOf' || name === 'isExtensible' ? '' : `:${keyText(key)}`;
      rec(`proxy.${name}${shown}`);
      return Reflect[name](...args);
    };
    const names = ['get', 'set', 'has', 'deleteProperty', 'ownKeys', 'getOwnPropertyDescriptor', 'defineProperty', 'getPrototypeOf', 'isExtensible'];
    return new Proxy(target, Object.fromEntries(names.map((name) => [name, trap(name)])));
  };
  const POOL = [
    () => undefined, () => null, () => 0, () => 1, () => -0, () => NaN, () => '', () => 'x', () => '0', () => true,
    () => false, () => 2n, () => Symbol('s'), () => ({}), () => [], () => [1, 2], () => ({ x: 1, y: 2 }),
    () => ({ get x() { rec('get x'); return 1; }, set x(value) { rec('set x'); }, get y() { rec('get y'); return 2; } }),
    () => ({ [Symbol.toPrimitive](hint) { rec(`prim:${hint}`); return hint === 'number' ? 3 : 'p'; } }),
    () => ({ valueOf() { rec('valueOf'); return 4; }, toString() { rec('toString'); return 'v'; } }),
    () => ({ *[Symbol.iterator]() { rec('iter:1'); yield 1; rec('iter:2'); yield 2; rec('iter:end'); } }),
    makeProxy,
    () => ({ get x() { rec('throw x'); throw new TypeError('x'); }, y: 2 }),
    () => function probe(...args) { rec(`call:${args.length}`); return 5; },
    () => Object.assign(Object.create(null), { x: 1 }),
    () => Object.freeze({ x: 1 }),
    () => ({ then(resolve) { rec('then'); resolve(6); } }),
    () => 'string', () => [1, , 3], () => ({ x: undefined }), () => 'Enter', () => -1,
    () => {
      const target = { a: 1, b: 'two', n: 3, items: ['i', 'j'], k: 'title', v: 'val' };
      for (const name of ['f', 'g']) {
        target[name] = (...args) => { rec(`call p.${name}(${args.length})`); return name; };
        inputs.set(target[name], `p.${name}`);
      }
      const get = (object, key) => {
        const isNamed = typeof key === 'string';
        if (isNamed) rec(`get p.${key}`);
        return object[key];
      };
      return new Proxy(target, { get });
    }
  ];
  const intrinsicErrors = [AggregateError, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError];
  const errorType = (err) => {
    const isObject = err !== null && (typeof err === 'object' || typeof err === 'function');
    const intrinsic = isObject ? intrinsicErrors.find((type) => err instanceof type) : null;
    if (intrinsic) return intrinsic.prototype.name;
    const isError = isObject && err instanceof Error;
    if (isError) return Object.getPrototypeOf(err) === Error.prototype ? 'Error' : 'Error-subclass';
    return `value:${serialize(err)}`;
  };
  const FUNCTION_KINDS = [
    [Object.getPrototypeOf(async function* () {}), 'async-generator'],
    [Object.getPrototypeOf(function* () {}), 'generator'],
    [Object.getPrototypeOf(async function () {}), 'async'],
    [Function.prototype, 'plain']
  ];
  const PROTO_TAGS = [
    [Object.prototype, 'Object'], [Array.prototype, 'Array'], [Function.prototype, 'Function'], [Promise.prototype, 'Promise'],
    [Map.prototype, 'Map'], [Set.prototype, 'Set'], [RegExp.prototype, 'RegExp'], [Date.prototype, 'Date'],
    [Object.getPrototypeOf(function* () {}).prototype, 'Generator'], [Object.getPrototypeOf(async function* () {}).prototype, 'AsyncGenerator']
  ];
  const isConstructor = (fn) => {
    try {
      Reflect.construct(String, [], fn);
      return true;
    } catch {
      return false;
    }
  };
  const describeFunction = (fn, depth, seen) => {
    const kind = FUNCTION_KINDS.find(([proto]) => Object.getPrototypeOf(fn) === proto)?.[1] ?? 'other';
    const source = Function.prototype.toString.call(fn);
    const isClass = /^class\b/.test(source);
    const own = Reflect.ownKeys(fn).filter((key) => key !== 'name' && key !== 'length' && key !== 'prototype' && key !== 'arguments' && key !== 'caller');
    const parts = own.map((key) => `${keyText(key)}=${serializeSlot(fn, key, depth, seen)}`);
    const proto = Object.prototype.hasOwnProperty.call(fn, 'prototype') ? serialize(fn.prototype, depth + 1, seen) : '-';
    return `fn(${kind}${isClass ? ' class' : ''}, len=${fn.length}, ctor=${isConstructor(fn)}, prototype=${proto}){${parts.join(',')}}`;
  };
  const serializeSlot = (object, key, depth, seen) => {
    const desc = Reflect.getOwnPropertyDescriptor(object, key);
    const flags = `${desc.enumerable ? 'e' : ''}${desc.writable ? 'w' : ''}${desc.configurable ? 'c' : ''}`;
    const isData = 'value' in desc;
    if (isData) return `${flags}:${serialize(desc.value, depth + 1, seen)}`;
    return `${flags}:accessor(${desc.get ? 'get' : ''}${desc.set ? 'set' : ''})`;
  };
  const protoTag = (value, depth, seen) => {
    const proto = Object.getPrototypeOf(value);
    const isBare = proto === null;
    if (isBare) return 'null';
    const known = PROTO_TAGS.find(([candidate]) => candidate === proto)?.[1];
    if (known) return known;
    return `proto(${serialize(proto, depth + 1, seen)})`;
  };
  const EXTRAS = [
    [Map, (value) => `entries=${serialize([...value.entries()], 3)}`],
    [Set, (value) => `values=${serialize([...value.values()], 3)}`],
    [RegExp, (value) => `re=${String(value)}`],
    [Date, (value) => `time=${value.getTime()}`]
  ];
  const extraOf = (value) => EXTRAS.find(([type]) => value instanceof type)?.[1](value) ?? '';
  // Node's async_hooks (on under node --test) tag promises with own symbols holding async ids.
  const isRuntimeKey = (key) => typeof key === 'symbol' && /^(async_id|trigger_async_id)_symbol$/.test(String(key.description));
  const serializeObject = (value, depth, seen) => {
    const tag = protoTag(value, depth, seen);
    const parts = Reflect.ownKeys(value).filter((key) => !isRuntimeKey(key)).map((key) => `${keyText(key)}=${serializeSlot(value, key, depth, seen)}`);
    const sealed = Object.isExtensible(value) ? '' : ' sealed';
    return `${tag}${sealed}{${parts.join(',')}}${extraOf(value)}`;
  };
  const PRIMITIVES = {
    undefined: () => 'undefined',
    number: (value) => (Object.is(value, -0) ? 'num:-0' : `num:${value}`),
    string: (value) => `str:${JSON.stringify(value)}`,
    boolean: (value) => `bool:${value}`,
    bigint: (value) => `big:${value}`,
    symbol: (value) => (inputs.has(value) ? `input:${inputs.get(value)}` : `sym:${value.description}`)
  };
  function serialize(value, depth = 0, seen = new Map()) {
    const isNull = value === null;
    if (isNull) return 'null';
    const primitive = PRIMITIVES[typeof value];
    if (primitive) return primitive(value);
    const isInput = inputs.has(value);
    if (isInput) return `input:${inputs.get(value)}`;
    const isSeen = seen.has(value);
    if (isSeen) return `ref:${seen.get(value)}`;
    const isTooDeep = depth > 12;
    if (isTooDeep) return '...';
    seen.set(value, seen.size);
    const wasQuiet = state.isQuiet;
    state.isQuiet = true;
    try {
      return typeof value === 'function' ? describeFunction(value, depth, seen) : serializeObject(value, depth, seen);
    } catch (err) {
      return `unserializable:${errorType(err)}`;
    } finally {
      state.isQuiet = wasQuiet;
    }
  }
  const makeInputs = (spec) => {
    const values = [];
    for (const [index, poolIndex] of spec.entries()) {
      const isProbe = poolIndex === -1;
      const value = isProbe ? (n) => { rec(`f(${serialize(n)})`); return values[Number(n) % 4 || 0]; } : POOL[poolIndex]();
      const isTracked = value !== null && (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol');
      if (isTracked) inputs.set(value, index);
      values.push(value);
    }
    return values;
  };
  const isIterator = (value) => value !== null && typeof value === 'object' && typeof value.next === 'function';
  const step = async (label, thunk) => {
    try {
      const result = await thunk();
      events.push(`${label}:${serialize(result)}`);
      return { ok: true, result };
    } catch (err) {
      events.push(`${label}-throw:${errorType(err)}`);
      return { ok: false };
    }
  };
  const drain = async (iterator) => {
    for (let index = 0; index < 6; index += 1) {
      const next = await step('next', () => iterator.next(index));
      const isDone = !next.ok || next.result === null || typeof next.result !== 'object' || next.result.done;
      if (isDone) return;
    }
  };
  const settle = async (value) => {
    const isThenable = value !== null && typeof value === 'object' && typeof value.then === 'function' && !inputs.has(value);
    if (isThenable) await step('await', () => value);
    if (isIterator(value)) await drain(value);
    const isFunction = typeof value === 'function' && !inputs.has(value);
    if (isFunction) await step('call0', () => value());
  };
  /**
   * Runs one invocation: thunk(values) -> outcome. The sandbox runs microtasks after each evaluation
   * (microtaskMode afterEvaluate), so `isDone` is set before control returns unless something never settles.
   */
  global.__fuzzRun = (spec, thunk) => {
    const values = makeInputs(spec);
    const finish = () => {
      global.__fuzzDone = true;
    };
    const conclude = async () => {
      await fireHandlers();
      recordEndState();
    };
    try {
      const returned = thunk(values);
      events.push(`ret:${serialize(returned)}`);
      settle(returned).then(conclude).then(finish, finish);
    } catch (err) {
      events.push(`throw:${errorType(err)}`);
      conclude().then(finish, finish);
    }
  };
  global.__fuzzDone = false;
  const PASSTHROUGH = new Set(['class', 'style', 'key', 'ref', 'id', 'className']);
  const templateMode = { isOn: false };
  const keptProps = (props) => {
    const isFiltered = templateMode.isOn && props !== null && typeof props === 'object';
    if (!isFiltered) return props;
    return Object.fromEntries(Object.entries(props).filter(([key]) => !PASSTHROUGH.has(key)).sort(([left], [right]) => (left < right ? -1 : Number(left > right))));
  };
  const jsxHandlers = [];
  const HANDLER_PROP = /^on[A-Z]/;
  const collectHandlers = (props) => {
    const isCollected = templateMode.isOn && props !== null && typeof props === 'object';
    if (!isCollected) return;
    for (const [key, value] of Object.entries(props)) {
      const isHandler = HANDLER_PROP.test(key) && typeof value === 'function';
      if (isHandler) jsxHandlers.push(value);
    }
  };
  global.__h = (type, props, ...children) => {
    collectHandlers(props);
    return { $type: type, props: keptProps(props), children };
  };
  global.__fuzzTemplate = (names) => {
    templateMode.isOn = true;
    for (const name of names) {
      const component = function () {};
      inputs.set(component, `component:${name}`);
      global[name] = component;
    }
  };
  global.__Fragment = Symbol('Fragment');
  const fakeEvent = (key) => {
    const target = { value: '5', checked: true };
    return {
      type: 'fuzz', key, target, currentTarget: target, button: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
      preventDefault: () => events.push('preventDefault'), stopPropagation: () => events.push('stopPropagation')
    };
  };
  /** Template mode: every rendered on[A-Z] handler runs under the two synthetic events the Vue path uses (#4560). */
  const fireHandlers = async () => {
    for (const [index, handler] of jsxHandlers.entries()) {
      for (const key of ['Enter', 'a']) {
        events.push(`fire handler#${index} ${key}`);
        try {
          const result = handler(fakeEvent(key));
          events.push(`handler-ret:${serialize(result)}`);
          const isThenable = result !== null && typeof result === 'object' && typeof result.then === 'function';
          if (isThenable) await step('handler-await', () => result);
        } catch (err) {
          events.push(`handler-throw:${errorType(err)}`);
        }
      }
    }
  };
  const baselineKeys = new Set(Reflect.ownKeys(global));
  const isHarnessKey = (key) => (typeof key === 'string' && key.startsWith('__fuzz')) || key === '__h' || key === '__Fragment';
  const quietly = (read) => {
    const wasQuiet = state.isQuiet;
    state.isQuiet = true;
    try {
      return read();
    } catch (err) {
      return `unserializable:${errorType(err)}`;
    } finally {
      state.isQuiet = wasQuiet;
    }
  };
  const objectState = (value) => quietly(() => (typeof value === 'function' ? describeFunction(value, 0, new Map([[value, 0]])) : serializeObject(value, 0, new Map([[value, 0]]))));
  /**
   * After the run settles (#4560): the end state of every object input, of the entry module's own
   * top-level bindings (sandbox.js exports them) and of the globals the code created, read through
   * descriptors with logging off, so a write the return value never shows still tells two sides apart.
   */
  const recordEndState = () => {
    for (const [value, label] of inputs) {
      const isObjectInput = typeof label === 'number' && value !== null && (typeof value === 'object' || typeof value === 'function');
      if (isObjectInput) events.push(`end input#${label}:${objectState(value)}`);
    }
    const bindings = typeof global.__fuzzBindings === 'function' ? quietly(() => global.__fuzzBindings()) : [];
    for (const [index, value] of bindings.entries()) events.push(`end binding#${index}:${quietly(() => serialize(value))}`);
    for (const key of Reflect.ownKeys(global)) {
      const isUserKey = !baselineKeys.has(key) && !isHarnessKey(key);
      const desc = isUserKey ? Reflect.getOwnPropertyDescriptor(global, key) : null;
      const isComponent = Boolean(desc) && 'value' in desc && inputs.has(desc.value);
      const isReported = Boolean(desc) && !isComponent;
      if (isReported) events.push(`end global ${keyText(key)}:${'value' in desc ? quietly(() => serialize(desc.value)) : 'accessor'}`);
    }
  };
  global.__fuzzEvents = events;
  global.__fuzzErrorType = errorType;
  global.__fuzzSerialize = serialize;
  global.__fuzzRec = rec;
}
