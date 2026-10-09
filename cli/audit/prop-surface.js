/**
 * The prop surface PROP_SURFACE_BLOAT measures: a component's own data props. React
 * spells DOM passthrough, slots and emits as props (className, children, ReactNode
 * slot props, on* callbacks, ...rest); Vue and Svelte adapters of the same atom do
 * not, so those are left out to keep grading framework-neutral (#1675).
 */
import * as t from '@babel/types';

const PASSTHROUGH_PROPS = new Set(['className', 'class', 'children', 'style', 'id', 'key', 'ref', 'slot']);
const CALLBACK_PROP = /^on[A-Z]/;
const SLOT_TYPES = new Set(['ReactNode', 'ReactElement', 'JSX.Element', 'React.ReactNode', 'React.ReactElement', 'Snippet']);

const qualifiedName = (node) => {
  if (t.isIdentifier(node)) return node.name;
  if (t.isTSQualifiedName(node)) return `${qualifiedName(node.left)}.${node.right.name}`;
  return '';
};

const isSlotType = (type) => {
  if (t.isTSTypeReference(type)) return SLOT_TYPES.has(qualifiedName(type.typeName));
  if (t.isTSUnionType(type)) return type.types.some(isSlotType);
  return false;
};

const keyName = (key) => {
  if (t.isIdentifier(key)) return key.name;
  return t.isStringLiteral(key) ? key.value : '';
};

const membersToTypes = (members = []) => new Map(members
  .filter((m) => t.isTSPropertySignature(m))
  .map((m) => [keyName(m.key), m.typeAnnotation?.typeAnnotation ?? null]));

const findDeclaredMembers = (funcPath, name) => {
  const program = funcPath.findParent((p) => p.isProgram());
  const statements = program?.node.body ?? [];
  for (const statement of statements) {
    const decl = t.isExportNamedDeclaration(statement) ? statement.declaration : statement;
    const isNamed = decl?.id?.name === name;
    const isInterface = isNamed && t.isTSInterfaceDeclaration(decl);
    const isLiteralAlias = isNamed && t.isTSTypeAliasDeclaration(decl) && t.isTSTypeLiteral(decl.typeAnnotation);
    if (isInterface) return decl.body.body;
    if (isLiteralAlias) return decl.typeAnnotation.members;
  }
  return [];
};

const FC_TYPES = new Set(['FC', 'React.FC', 'FunctionComponent', 'React.FunctionComponent']);

/** `const X: React.FC<Props> = ({ ... }) => ...` carries the props type on the variable. */
const componentTypeArgument = (funcPath) => {
  const declarator = funcPath.parentPath?.node;
  const varType = t.isVariableDeclarator(declarator) ? declarator.id.typeAnnotation?.typeAnnotation : null;
  const isFcType = t.isTSTypeReference(varType) && FC_TYPES.has(qualifiedName(varType.typeName));
  return isFcType ? varType.typeParameters?.params?.[0] ?? null : null;
};

const resolvePropTypes = (funcPath, param) => {
  const annotation = param.typeAnnotation?.typeAnnotation ?? componentTypeArgument(funcPath);
  if (t.isTSTypeLiteral(annotation)) return membersToTypes(annotation.members);
  const isNamedType = t.isTSTypeReference(annotation) && t.isIdentifier(annotation.typeName);
  return isNamedType ? membersToTypes(findDeclaredMembers(funcPath, annotation.typeName.name)) : new Map();
};

const isPlumbingProp = (name, type) => PASSTHROUGH_PROPS.has(name) || CALLBACK_PROP.test(name) || isSlotType(type);

/** Data props destructured from the first parameter, without React passthrough/slot/callback props. */
export const countSurfaceProps = (funcPath) => {
  const firstParam = funcPath.node.params?.[0];
  if (!t.isObjectPattern(firstParam)) return 0;
  const types = resolvePropTypes(funcPath, firstParam);
  const named = firstParam.properties.filter((p) => t.isObjectProperty(p)).map((p) => keyName(p.key));
  return named.filter((name) => !isPlumbingProp(name, types.get(name))).length;
};
