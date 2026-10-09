// Convention entries for R7 (engine doc, Library: a convention is a house shape that suppresses
// detection). Until the P4 library registry ships, the kit's two house shapes from the ground truth live
// here; each names the AGENTS.md directive that asks for the repetition:
//   capsule-controller-return  a capsule controller (*.controller.ts|js) ends by returning its computeds
//                              and handlers as a shorthand object literal (B7). The shape is required by
//                              the capsule layout, so it is never an extraction candidate.
//   toc-view                   a view (views/v-*.vue) whose template is one template-tier layout
//                              (T<Name>) filled with organisms (B6): the 10-20 line table-of-contents
//                              view the Table-of-contents rule asks for.
// conventionOf(ctx) takes { kind, files, trees, tags }: trees are unit trees (unit-trees.js) for
// script groups, tags the root element tags of template groups.

const CONTROLLER_FILE = /\.controller\.[cm]?[jt]s$/;
const VIEW_FILE = /(^|\/)views\/v-[^/]+\.vue$/;
const TEMPLATE_TIER_TAG = /^T[A-Z]/;

const isShorthandProperty = (property) => {
  const isProperty = property.type === 'ObjectProperty';
  const key = property.kids?.key;
  const value = property.kids?.value;
  return isProperty && key?.type === 'KeyName' && value?.type === 'Identifier' && key.label === value.label;
};

const isShorthandReturn = (statement) => {
  const argument = statement?.type === 'ReturnStatement' ? statement.kids.argument : null;
  const isObject = argument?.type === 'ObjectExpression' && argument.kids.properties.length > 0;
  return isObject && argument.kids.properties.every(isShorthandProperty);
};

// The last statement a unit tree ends with: the statement itself, a window's last, or a fn body's last.
const lastStatementOf = (tree) => {
  const root = tree?.root;
  const isList = Array.isArray(root);
  if (isList) return root.at(-1);
  const isBlock = root?.type === 'BlockStatement';
  return isBlock ? root.kids.body.at(-1) : root;
};

export const CONVENTIONS = Object.freeze([
  Object.freeze({
    id: 'capsule-controller-return',
    matches: (ctx) => ctx.kind !== 'tmpl' && ctx.files.every((file) => CONTROLLER_FILE.test(file)) && ctx.trees.length > 0 && ctx.trees.every((tree) => isShorthandReturn(lastStatementOf(tree)))
  }),
  Object.freeze({
    id: 'toc-view',
    matches: (ctx) => ctx.kind === 'tmpl' && ctx.files.every((file) => VIEW_FILE.test(file)) && ctx.tags.length > 0 && ctx.tags.every((tag) => TEMPLATE_TIER_TAG.test(tag ?? ''))
  })
]);

/** The id of the first convention the group matches, or null. */
export const conventionOf = (ctx) => CONVENTIONS.find((convention) => convention.matches({ trees: [], tags: [], ...ctx }))?.id ?? null;
