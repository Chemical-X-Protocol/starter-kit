// PHP declarations from the php-parser tree (design spec section 6).
// One walker yields namespaces, classes, interfaces, traits, enums, functions, methods,
// properties and constants. On a parse error it retries with suppressErrors for a partial result.

import { parsePhp } from './php-parse.js';
import { walk, nodeLine, endLine } from './php-walk.js';

const TYPE_DECLS = new Set(['class', 'interface', 'trait', 'enum']);

function nameOf(value) {
  const isMissing = value == null;
  const isText = typeof value === 'string';
  const resolve = isText ? () => value : () => nameOf(value.name);
  return isMissing ? '' : resolve();
}

const TYPE_RENDERERS = {
  nullable: (type) => `?${typeText(type.what)}`,
  uniontype: (type) => type.types.map((t) => typeText(t)).join('|'),
  intersectiontype: (type) => type.types.map((t) => typeText(t)).join('&'),
};

// php-parser puts the leading `?` of `?int` on the owning node (param or function), not the type.
function typeText(type, nullable = false) {
  const isPresent = Boolean(type);
  const render = TYPE_RENDERERS[type && type.kind] || nameOf;
  const isCompound = type && Boolean(TYPE_RENDERERS[type.kind]);
  return isPresent ? `${nullable && !isCompound ? '?' : ''}${render(type)}` : '';
}

function paramText(param) {
  const type = typeText(param.type, param.nullable);
  const variadic = param.variadic ? '...' : '';
  const byRef = param.byref ? '&' : '';
  return `${type ? `${type} ` : ''}${byRef}${variadic}$${nameOf(param.name)}`;
}

function callableSignature(node, qualifier) {
  const params = (node.arguments || []).map(paramText).join(', ');
  const returns = typeText(node.type, node.nullable);
  return `${qualifier}${nameOf(node.name)}(${params})${returns ? `: ${returns}` : ''}`;
}

function symbol(node, fields) {
  return {
    name: '',
    container: null,
    kind: '',
    visibility: null,
    isStatic: false,
    isAbstract: false,
    isMember: false,
    startLine: nodeLine(node),
    endLine: endLine(node),
    signature: '',
    ...fields,
  };
}

const MEMBER_SYMBOLS = {
  method: (node, container, visibility) => [
    symbol(node, {
      name: nameOf(node.name), container, kind: 'method', visibility,
      isStatic: Boolean(node.isStatic), isAbstract: Boolean(node.isAbstract),
      signature: callableSignature(node, `${container}::`),
    }),
  ],
  classconstant: (node, container, visibility) =>
    node.constants.map((c) =>
      symbol(node, { name: nameOf(c.name), container, kind: 'const', visibility, signature: `${container}::${nameOf(c.name)}` }),
    ),
  propertystatement: (node, container, visibility) =>
    node.properties.map((p) =>
      symbol(node, {
        name: nameOf(p.name), container, kind: 'property', visibility,
        isStatic: Boolean(node.isStatic), signature: `${container}::$${nameOf(p.name)}`,
      }),
    ),
  traituse: (node, container) => {
    const traits = node.traits.map(nameOf);
    return [symbol(node, { name: traits.join(', '), container, kind: 'use', signature: `use ${traits.join(', ')}` })];
  },
  enumcase: (node, container) => [
    symbol(node, { name: nameOf(node.name), container, kind: 'case', signature: `${container}::${nameOf(node.name)}` }),
  ],
};

function memberSymbols(node, container) {
  const build = MEMBER_SYMBOLS[node.kind];
  const built = build ? build(node, container, node.visibility || 'public') : [];
  return built.map((sym) => ({ ...sym, isMember: true }));
}

function extendsText(node) {
  const parents = [].concat(node.extends || []);
  return parents.map(nameOf).join(', ');
}

function typeSignature(node) {
  const implemented = (node.implements || []).map(nameOf).join(', ');
  return [
    node.isAbstract ? 'abstract' : '',
    node.isFinal ? 'final' : '',
    node.kind,
    nameOf(node.name),
    node.extends ? `extends ${extendsText(node)}` : '',
    implemented ? `implements ${implemented}` : '',
  ].filter(Boolean).join(' ');
}

function collect(ast) {
  const out = [];
  const into = (node, ns) => walk(node, (n) => visit(n, ns));

  const onNamespace = (node) => {
    const name = nameOf(node.name);
    out.push(...(name ? [symbol(node, { name, kind: 'namespace', signature: `namespace ${name}` })] : []));
    (node.children || []).forEach((child) => into(child, name || null));
    return false;
  };

  const onMember = (member, container) => {
    out.push(...memberSymbols(member, container));
    // Declarations nested in a method body still count (rare: functions and classes).
    const nestedBody = member.kind === 'method' ? member.body : null;
    return nestedBody ? into(nestedBody, null) : undefined;
  };

  const onTypeDecl = (node, ns) => {
    const name = nameOf(node.name);
    const isNamed = Boolean(name);
    const record = () => {
      out.push(symbol(node, { name, container: ns, kind: node.kind, isAbstract: Boolean(node.isAbstract), signature: typeSignature(node) }));
      (node.body || []).forEach((member) => onMember(member, name));
    };
    return isNamed ? record() : undefined; // an anonymous class is not a named declaration
  };

  const onFunction = (node, ns) => {
    const name = nameOf(node.name);
    out.push(...(name ? [symbol(node, { name, container: ns, kind: 'function', signature: callableSignature(node, '') })] : []));
    return true;
  };

  const onConstants = (node, ns) => {
    (node.constants || []).forEach((c) =>
      out.push(symbol(node, { name: nameOf(c.name), container: ns, kind: 'const', signature: `const ${nameOf(c.name)}` })),
    );
    return false;
  };

  const onType = (node, ns) => {
    onTypeDecl(node, ns);
    return false;
  };

  const HANDLERS = {
    namespace: onNamespace,
    function: onFunction,
    constantstatement: onConstants,
    ...Object.fromEntries([...TYPE_DECLS].map((kind) => [kind, onType])),
  };

  function visit(node, ns) {
    const handler = HANDLERS[node.kind];
    return handler ? handler(node, ns) : true;
  }

  into(ast, null);
  return out;
}

const INDEX_KINDS = { class: 'class', interface: 'class', trait: 'class', enum: 'class', function: 'function', method: 'function' };

/**
 * Index rows for extractAstMetadata: types, functions and methods. Methods keep their
 * own name with `Class::method` in the signature. Constants, properties, trait uses, enum cases and
 * namespaces are not indexed (the outline lists them). No regex fallback: a file that does not parse yields no rows.
 */
export function phpIndexMetadata(content, filePath = 'file.php') {
  const indexed = extractPhpSymbols(content, filePath).symbols.filter((sym) => INDEX_KINDS[sym.kind]);
  const symbols = indexed.map((sym) => ({
    name: sym.name,
    kind: INDEX_KINDS[sym.kind],
    isExport: sym.visibility !== 'private',
    startLine: sym.startLine,
    endLine: sym.endLine,
    signature: sym.signature,
  }));
  return { symbols, props: [], hooks: [], imports: [] };
}

/**
 * @returns {{symbols: object[], partial: boolean, status: 'ok'|'partial'|'error'|'minified'|'unavailable'}}
 * Symbols are in source order. A file that cannot be parsed even leniently yields no symbols.
 */
export function extractPhpSymbols(content, filePath = 'file.php') {
  const strict = parsePhp(content, { filePath });
  const lenient = strict.error ? parsePhp(content, { filePath, suppressErrors: true }) : strict;
  const failure = ['skipped', 'unavailable'].find((key) => strict[key]);
  const failureStatus = { skipped: 'minified', unavailable: 'unavailable' }[failure] || 'error';
  const parsedStatus = strict.ast ? 'ok' : 'partial';
  const status = lenient.ast ? parsedStatus : failureStatus;
  return {
    symbols: lenient.ast ? collect(lenient.ast) : [],
    partial: status === 'partial',
    status,
  };
}
