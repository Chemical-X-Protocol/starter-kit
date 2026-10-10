// Top-level bindings of an entry module as a fuzz-sandbox hook (#4560): the harness reads their values
// after a run settles, so a write to module scope that the return value never shows still counts.
// The names come from the compiled (CommonJS-shaped) entry text; text that does not parse gets no hook.
// Values are listed in declaration order, never by name: renaming a binding nothing reads is a sound merge.
import { parse } from '../../babel-lazy.js';

const patternNames = (node) => {
  const handlers = {
    Identifier: () => [node.name],
    ObjectPattern: () => node.properties.flatMap((property) => patternNames(property.type === 'RestElement' ? property.argument : property.value)),
    ArrayPattern: () => node.elements.flatMap((element) => (element ? patternNames(element) : [])),
    AssignmentPattern: () => patternNames(node.left),
    RestElement: () => patternNames(node.argument)
  };
  return (handlers[node.type] ?? (() => []))();
};

const declaredNames = (statement) => {
  const isVariable = statement.type === 'VariableDeclaration';
  if (isVariable) return statement.declarations.flatMap((declarator) => patternNames(declarator.id));
  const isNamed = (statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') && statement.id;
  return isNamed ? [statement.id.name] : [];
};

/** Source of a statement that publishes `globalThis.__fuzzBindings()` for the module's top-level names ('' when none). */
export const bindingHook = (js) => {
  let names = [];
  try {
    const ast = parse(js, { sourceType: 'script', allowReturnOutsideFunction: true });
    names = [...new Set(ast.program.body.flatMap(declaredNames))];
  } catch {
    return '';
  }
  const reads = names.map((name) => `try { out.push(${name}); } catch (err) { out.push('tdz'); }`);
  return `\n;try { globalThis.__fuzzBindings = () => { const out = []; ${reads.join(' ')} return out; }; } catch (err) { /* frozen global */ }`;
};
