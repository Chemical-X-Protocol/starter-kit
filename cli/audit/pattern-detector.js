/**
 * Chemical X Protocol: Structural Pattern Harmonization Detector
 * Single-pass AST fingerprinting to discover cross-file clones and extraction candidates.
 */

const MIN_UNION_MEMBERS = 3;
const MIN_CHILD_NODES = 2;

export const createPatternRegistry = () => {
  const buckets = new Map();

  const record = (type, signature, location) => {
    if (!signature) return;
    const key = `${type}::${signature}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        type,
        signature,
        detail: location.detail || signature,
        occurrences: []
      };
      buckets.set(key, bucket);
    }
    bucket.occurrences.push({
      filePath: location.filePath,
      line: location.line || 1,
      column: location.column || 1
    });
  };

  const resolveHarmonizationCandidates = (hotspots = []) => {
    const hotspotFiles = new Set(hotspots.map((h) => h.filePath));
    const candidates = [];

    for (const [key, bucket] of buckets.entries()) {
      const uniqueFiles = Array.from(new Set(bucket.occurrences.map((o) => o.filePath)));
      if (uniqueFiles.length < 2) continue;

      const hasHotspot = uniqueFiles.some((f) => hotspotFiles.has(f));
      const impactScore = uniqueFiles.length * (hasHotspot ? 3 : 1.5) + bucket.occurrences.length;

      let label = 'Recurring Pattern';
      let suggestedCapsule = 'm-shared-capsule';
      let recommendation = 'Extract canonical capsule before decomposing consumers';

      if (bucket.type === 'STATE_UNION') {
        label = `Shared State Machine (${bucket.detail})`;
        suggestedCapsule = 'types/state.d.ts';
        recommendation = 'Extract shared discriminated union into domain types to eliminate duplicate definitions';
      } else if (bucket.type === 'UI_STRUCTURE') {
        label = `Shared UI Layout Structure (${bucket.detail})`;
        suggestedCapsule = 'm-feature-card';
        recommendation = 'Extract canonical molecule capsule before slicing consumer monoliths';
      } else if (bucket.type === 'PREDICATE_LOGIC') {
        label = `Duplicated Boolean Predicate Topology (${bucket.detail})`;
        suggestedCapsule = 'usePredicateFilter.ts';
        recommendation = 'Extract named predicate callback or higher-order filter function';
      } else if (bucket.type === 'HOOK_SIGNATURE') {
        label = `Parallel State Controller Return (${bucket.detail})`;
        suggestedCapsule = 'useSharedController.ts';
        recommendation = 'Unify ad-hoc local state returns into a canonical domain composable';
      }

      candidates.push({
        id: key,
        type: bucket.type,
        label,
        detail: bucket.detail,
        suggestedCapsule,
        recommendation,
        fileCount: uniqueFiles.length,
        totalHits: bucket.occurrences.length,
        hasHotspot,
        impactScore,
        occurrences: bucket.occurrences
      });
    }

    return candidates.sort((a, b) => b.impactScore - a.impactScore).slice(0, 12);
  };

  return { record, resolveHarmonizationCandidates };
};

export const createPatternVisitors = (registry, relativePath) => {
  if (!registry) return {};

  const getJsxTagName = (node) => {
    if (!node || !node.openingElement) return null;
    const nameNode = node.openingElement.name;
    if (nameNode.type === 'JSXIdentifier') return nameNode.name;
    if (nameNode.type === 'JSXMemberExpression') return `${nameNode.object.name}.${nameNode.property.name}`;
    return null;
  };

  const getJsxHierarchy = (node, depth = 0) => {
    if (depth > 2 || !node || node.type !== 'JSXElement') return '';
    const tag = getJsxTagName(node);
    if (!tag) return '';

    const elementChildren = (node.children || [])
      .filter((c) => c.type === 'JSXElement')
      .map((c) => getJsxHierarchy(c, depth + 1))
      .filter(Boolean);

    if (elementChildren.length === 0) return tag;
    return `${tag}>(${elementChildren.join('+')})`;
  };

  return {
    TSTypeAliasDeclaration(path) {
      const typeAnnotation = path.node.typeAnnotation;
      if (typeAnnotation && typeAnnotation.type === 'TSUnionType') {
        const literals = (typeAnnotation.types || [])
          .filter((t) => t.type === 'TSLiteralType' && typeof t.literal?.value === 'string')
          .map((t) => `'${t.literal.value}'`);

        if (literals.length >= MIN_UNION_MEMBERS) {
          const sorted = Array.from(new Set(literals)).sort().join(' | ');
          registry.record('STATE_UNION', sorted, {
            filePath: relativePath,
            line: path.node.loc?.start?.line,
            detail: sorted
          });
        }
      }
    },

    JSXElement(path) {
      const directElementChildren = (path.node.children || []).filter((c) => c.type === 'JSXElement');
      if (directElementChildren.length >= MIN_CHILD_NODES) {
        const hierarchy = getJsxHierarchy(path.node);
        if (hierarchy && hierarchy.includes('>')) {
          registry.record('UI_STRUCTURE', hierarchy, {
            filePath: relativePath,
            line: path.node.loc?.start?.line,
            detail: hierarchy
          });
        }
      }
    },

    LogicalExpression(path) {
      let clauseCount = 1;
      let curr = path.node;
      while (curr && curr.type === 'LogicalExpression') {
        clauseCount++;
        curr = curr.left;
      }
      if (clauseCount >= 3) {
        const sig = `CLAUSES_${clauseCount}_OP_${path.node.operator}`;
        registry.record('PREDICATE_LOGIC', sig, {
          filePath: relativePath,
          line: path.node.loc?.start?.line,
          detail: `${clauseCount}-clause ${path.node.operator} condition`
        });
      }
    },

    ReturnStatement(path) {
      const functionParent = path.getFunctionParent();
      const fnName = functionParent?.node?.id?.name;
      const isHook = fnName && /^use[A-Z]/.test(fnName);

      if (isHook && path.node.argument && path.node.argument.type === 'ObjectExpression') {
        const props = (path.node.argument.properties || [])
          .filter((p) => p.type === 'ObjectProperty' && p.key?.name)
          .map((p) => p.key.name);

        if (props.length >= 3) {
          const sorted = props.sort().join(',');
          registry.record('HOOK_SIGNATURE', sorted, {
            filePath: relativePath,
            line: path.node.loc?.start?.line,
            detail: `{ ${sorted.replace(/,/g, ', ')} }`
          });
        }
      }
    }
  };
};
