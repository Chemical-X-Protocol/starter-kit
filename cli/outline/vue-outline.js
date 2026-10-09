/**
 * Vue-aware outline lines: compiler macros (defineProps, defineEmits, defineModel,
 * defineExpose, withDefaults), Options API objects (defineComponent / export
 * default {}), and Pinia defineStore (options and setup forms).
 */
import { lazyTypes as t } from '../babel-lazy.js';

const MACROS = new Set(['defineProps', 'defineEmits', 'defineModel', 'defineExpose', 'defineSlots', 'defineOptions']);
const OPTION_SECTIONS = ['props', 'emits', 'data', 'computed', 'methods', 'watch', 'setup', 'state', 'getters', 'actions'];

const isCallNamed = (node, names) => t.isCallExpression(node) && t.isIdentifier(node.callee) && names.has(node.callee.name);
const keyName = (key) => (t.isIdentifier(key) ? key.name : t.isStringLiteral(key) ? key.value : '');
const objectKeys = (obj) => (t.isObjectExpression(obj) ? obj.properties.map((p) => keyName(p.key)).filter(Boolean) : []);
const compact = (text) => text.replace(/\s+/g, ' ').trim();

const returnedObject = (fn) => {
  const isFunction = t.isArrowFunctionExpression(fn) || t.isFunctionExpression(fn) || t.isObjectMethod(fn);
  if (!isFunction) return null;
  if (t.isObjectExpression(fn.body)) return fn.body;
  const isParenthesized = t.isParenthesizedExpression(fn.body) && t.isObjectExpression(fn.body.expression);
  if (isParenthesized) return fn.body.expression;
  const body = t.isBlockStatement(fn.body) ? fn.body.body : [];
  const ret = [...body].reverse().find((stmt) => t.isReturnStatement(stmt));
  return t.isObjectExpression(ret?.argument) ? ret.argument : null;
};

const typeMemberNames = (code, typeNode) => {
  if (!t.isTSTypeLiteral(typeNode)) return compact(code.slice(typeNode.start, typeNode.end));
  return typeNode.members.map((m) => {
    const isCallSignature = t.isTSCallSignatureDeclaration(m);
    const firstParam = isCallSignature ? m.parameters[0]?.typeAnnotation?.typeAnnotation : null;
    const eventName = firstParam?.literal?.value;
    if (eventName) return eventName;
    return compact(code.slice(m.start, m.end)).replace(/;$/, '');
  }).join(', ');
};

/** `defineProps { title: string, count?: number }` style line, or null. */
export const describeVueMacro = (code, node) => {
  const isWithDefaults = isCallNamed(node, new Set(['withDefaults'])) && isCallNamed(node.arguments[0], MACROS);
  const call = isWithDefaults ? node.arguments[0] : node;
  if (!isCallNamed(call, MACROS)) return null;
  const typeArg = call.typeParameters?.params?.[0];
  const arg = call.arguments[0];
  let detail = '';
  if (typeArg) detail = typeMemberNames(code, typeArg);
  else if (t.isObjectExpression(arg)) detail = objectKeys(arg).join(', ');
  else if (t.isArrayExpression(arg)) detail = arg.elements.filter(t.isStringLiteral).map((el) => el.value).join(', ');
  return `${call.callee.name} { ${detail} }`;
};

const describeSections = (obj, indent = '  ') => {
  const lines = [];
  for (const prop of obj.properties) {
    const section = keyName(prop.key);
    if (!OPTION_SECTIONS.includes(section)) continue;
    const value = t.isObjectProperty(prop) ? prop.value : prop;
    const returned = returnedObject(value);
    const members = returned ? objectKeys(returned) : objectKeys(value);
    const isArray = t.isArrayExpression(value);
    const names = isArray ? value.elements.filter(t.isStringLiteral).map((el) => el.value) : members;
    if (names.length > 0) lines.push(`${indent}${section}: ${names.join(', ')}`);
  }
  return lines;
};

/** One level into `export default {}` / `defineComponent({})`. */
export const describeComponentOptions = (code, decl) => {
  const isDefineComponent = isCallNamed(decl, new Set(['defineComponent'])) && t.isObjectExpression(decl.arguments[0]);
  const obj = isDefineComponent ? decl.arguments[0] : decl;
  return t.isObjectExpression(obj) ? describeSections(obj) : [];
};

/** Members of a Pinia store: options form sections, or the setup function's returned keys. */
export const describeStore = (code, init) => {
  if (!isCallNamed(init, new Set(['defineStore']))) return null;
  const definition = init.arguments.find((arg) => t.isObjectExpression(arg) || t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg));
  if (t.isObjectExpression(definition)) return describeSections(definition);
  const returned = returnedObject(definition);
  return returned ? [`  returns: ${objectKeys(returned).join(', ')}`] : [];
};
