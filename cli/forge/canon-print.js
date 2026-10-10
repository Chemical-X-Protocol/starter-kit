// Prints a canonical tree back as runnable JavaScript, fully parenthesized. Forge never writes this
// into a project: it exists so soundness can be property-tested (original and canonical forms must
// evaluate equal) and so a fingerprint can be explained to a person. Covers the expression and
// statement subset that canonicalization rewrites; anything else throws, naming the node type.

const operatorOf = (node) => node.label.split(' ')[0].slice('operator:'.length);
const hasFlag = (node, flag) => node.label.split(' ').includes(flag);
const joinWith = (nodes, separator) => nodes.map((node) => printCanonical(node)).join(separator);

const escapeQuasi = (text) => text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const printTemplate = (node) => {
  const quasis = node.kids.quasis.map((quasi) => escapeQuasi(quasi.label));
  const parts = quasis.map((quasi, index) => {
    const expression = node.kids.expressions[index];
    return expression ? `${quasi}\${${printCanonical(expression)}}` : quasi;
  });
  return `\`${parts.join('')}\``;
};

const printUnary = (node) => {
  const operator = operatorOf(node);
  const isWord = /^[a-z]/.test(operator);
  return `(${operator}${isWord ? ' ' : ''}${printCanonical(node.kids.argument)})`;
};

const printMember = (node) => {
  const object = printCanonical(node.kids.object);
  const property = printCanonical(node.kids.property);
  const isComputed = hasFlag(node, 'computed');
  const plainAccess = isComputed ? `[${property}]` : `.${property}`;
  const optionalAccess = isComputed ? `?.[${property}]` : `?.${property}`;
  const isOptional = hasFlag(node, 'optional');
  return `${object}${isOptional ? optionalAccess : plainAccess}`;
};

const printFunction = (node) => {
  const params = joinWith(node.kids.params, ', ');
  const prefix = hasFlag(node, 'async') ? 'async ' : '';
  const isArrow = node.type === 'ArrowFunctionExpression';
  const body = printCanonical(node.kids.body);
  return isArrow ? `(${prefix}(${params}) => ${body})` : `(${prefix}function (${params}) ${body})`;
};

const printIf = (node) => {
  const head = `if (${printCanonical(node.kids.test)}) ${printCanonical(node.kids.consequent)}`;
  const alternate = node.kids.alternate;
  return alternate ? `${head} else ${printCanonical(alternate)}` : head;
};

const printDeclaration = (node) => {
  const kind = node.label.replace('kind:', '');
  const declarators = node.kids.declarations.map((declarator) => {
    const init = declarator.kids.init;
    const id = printCanonical(declarator.kids.id);
    return init ? `${id} = ${printCanonical(init)}` : id;
  });
  return `${kind} ${declarators.join(', ')};`;
};

const printProperty = (node) => {
  const key = node.kids.key;
  const isNamedKey = key.type === 'KeyName';
  const keyText = isNamedKey ? JSON.stringify(key.label) : `[${printCanonical(key)}]`;
  return `${keyText}: ${printCanonical(node.kids.value)}`;
};

/** Array elements; a trailing hole needs its own comma (`[a, ,]` has length 2). */
const printElements = (node) => {
  const elements = node.kids.elements;
  const isTrailingHole = elements.at(-1)?.type === 'ArrayHole';
  return `[${joinWith(elements, ', ')}${isTrailingHole ? ',' : ''}]`;
};

const PRINTERS = {
  Program: (node) => joinWith(node.kids.body, '\n'),
  BlockStatement: (node) => `{ ${joinWith(node.kids.body, ' ')} }`,
  ExpressionStatement: (node) => `${printCanonical(node.kids.expression)};`,
  ReturnStatement: (node) => (node.kids.argument ? `return ${printCanonical(node.kids.argument)};` : 'return;'),
  ThrowStatement: (node) => `throw ${printCanonical(node.kids.argument)};`,
  IfStatement: printIf,
  VariableDeclaration: printDeclaration,
  Identifier: (node) => node.label,
  PropName: (node) => node.label,
  StringLiteral: (node) => node.label,
  NumericLiteral: (node) => node.label,
  BooleanLiteral: (node) => node.label,
  NullLiteral: () => 'null',
  RegExpLiteral: (node) => node.label,
  BigIntLiteral: (node) => node.label,
  TemplateLiteral: printTemplate,
  UnaryExpression: printUnary,
  BinaryExpression: (node) => `(${printCanonical(node.kids.left)} ${operatorOf(node)} ${printCanonical(node.kids.right)})`,
  LogicalExpression: (node) => `(${printCanonical(node.kids.left)} ${operatorOf(node)} ${printCanonical(node.kids.right)})`,
  AssignmentExpression: (node) => `(${printCanonical(node.kids.left)} ${operatorOf(node)} ${printCanonical(node.kids.right)})`,
  LogicalNary: (node) => `(${joinWith(node.kids.operands, ` ${node.label} `)})`,
  ConditionalExpression: (node) => `(${printCanonical(node.kids.test)} ? ${printCanonical(node.kids.consequent)} : ${printCanonical(node.kids.alternate)})`,
  CallExpression: (node) => `${printCanonical(node.kids.callee)}(${joinWith(node.kids.arguments, ', ')})`,
  NewExpression: (node) => `(new ${printCanonical(node.kids.callee)}(${joinWith(node.kids.arguments, ', ')}))`,
  MemberExpression: printMember,
  OptionalMemberExpression: printMember,
  ArrowFunctionExpression: printFunction,
  FunctionExpression: printFunction,
  ArrayExpression: printElements,
  ArrayHole: () => '',
  ObjectExpression: (node) => `({ ${joinWith(node.kids.properties, ', ')} })`,
  ObjectProperty: printProperty,
  ObjectPattern: (node) => `{ ${joinWith(node.kids.properties, ', ')} }`,
  ArrayPattern: printElements,
  AssignmentPattern: (node) => `${printCanonical(node.kids.left)} = ${printCanonical(node.kids.right)}`,
  AwaitExpression: (node) => `(await ${printCanonical(node.kids.argument)})`,
  SequenceExpression: (node) => `(${joinWith(node.kids.expressions, ', ')})`
};

/** JavaScript source for a canonical node. Throws on node types outside the printable subset. */
export const printCanonical = (node) => {
  const printer = PRINTERS[node.type];
  if (!printer) throw new Error(`printCanonical: unsupported canonical node ${node.type}`);
  return printer(node);
};
