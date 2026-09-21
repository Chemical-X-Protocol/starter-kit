import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;

export const convertReactControllerToVue = (code) => {
  let out = code.replace(/import\s*\{[^}]*\}\s*from\s*['"]react['"];?\n?/, "import { ref, computed } from 'vue';\n");

  const stateVars = new Set();

  out = out.replace(
    /const\s*\[([a-zA-Z0-9_]+),\s*([a-zA-Z0-9_]+)\]\s*=\s*useState(?:<([^>]+)>)?\(([\s\S]*?)\);/g,
    (match, varName, setterName, typeAnnotation, initVal) => {
      stateVars.add(varName);
      const typeStr = typeAnnotation ? `<${typeAnnotation}>` : '';
      return `const ${varName} = ref${typeStr}(${initVal});\n  const ${setterName} = (val: any) => { ${varName}.value = typeof val === 'function' ? val(${varName}.value) : val; };`;
    }
  );

  out = out.replace(/useMemo\(\s*\(\)\s*=>\s*([\s\S]*?),\s*\[[^\]]*\]\s*\)/g, 'computed(() => $1)');

  try {
    const ast = parse(out, { sourceType: 'module', plugins: ['typescript'] });
    const replaceOffsets = [];

    traverse(ast, {
      Identifier(path) {
        if (!stateVars.has(path.node.name)) return;
        if (!path.isReferencedIdentifier()) return;
        if (path.findParent((p) => p.isTSType() || p.isTypeAnnotation())) return;
        if (
          path.parent.type === 'MemberExpression' &&
          path.parent.object === path.node &&
          path.parent.property.name === 'value'
        ) {
          return;
        }
        const fnParent = path.getFunctionParent();
        const retParent = path.findParent((p) => p.isReturnStatement());
        if (retParent && retParent.getFunctionParent() === fnParent && fnParent?.parent?.type === 'VariableDeclarator') {
          const declaratorId = fnParent.parent.id;
          if (declaratorId?.name?.startsWith('use') || declaratorId?.name?.startsWith('create')) {
            return;
          }
        }

        replaceOffsets.push({
          name: path.node.name,
          start: path.node.start,
          end: path.node.end
        });
      }
    });

    replaceOffsets.sort((a, b) => b.start - a.start);
    for (const o of replaceOffsets) {
      out = out.slice(0, o.start) + `${o.name}.value` + out.slice(o.end);
    }
  } catch {
    for (const v of stateVars) {
      const varRegex = new RegExp(`(?<![.\\w$])\\b${v}\\b(?!\\.value)(?!:)`, 'g');
      out = out.replace(varRegex, `${v}.value`);
    }
  }

  return out;
};

export const convertReactControllerToSvelte = (code, name, pascalName) => {
  let out = code.replace(/import\s*\{[^}]*\}\s*from\s*['"]react['"];?\n?/, '');

  out = out.replace(
    /const\s*\[([a-zA-Z0-9_]+),\s*([a-zA-Z0-9_]+)\]\s*=\s*useState(?:<([^>]+)>)?\(([\s\S]*?)\);/g,
    (match, varName, setterName, typeAnnotation, initVal) => {
      const typeStr = typeAnnotation ? `<${typeAnnotation}>` : '';
      return `let ${varName} = $state${typeStr}(${initVal});\n  const ${setterName} = (val: any) => { ${varName} = typeof val === 'function' ? val(${varName}) : val; };`;
    }
  );

  out = out.replace(/useMemo\(\s*\(\)\s*=>\s*([\s\S]*?),\s*\[[^\]]*\]\s*\)/g, (match, body) => {
    const trimmed = body.trim();
    if (trimmed.startsWith('{')) {
      return `$derived.by(() => ${trimmed})`;
    }
    return `$derived(${trimmed})`;
  });

  if (!out.includes(`create${pascalName}Controller`)) {
    out += `\nexport const create${pascalName}Controller = use${pascalName}Controller;\n`;
  }

  return out;
};
