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

  const resolveHarmonizationCandidates = (hotspots = [], options = {}) => {
    const hotspotFiles = new Set(hotspots.map((h) => h.filePath));
    const candidates = [];
    const minFiles = options.ruleOfThree ? 3 : 2;

    for (const [key, bucket] of buckets.entries()) {
      const uniqueFiles = Array.from(new Set(bucket.occurrences.map((o) => o.filePath)));
      const hasHotspot = uniqueFiles.some((f) => hotspotFiles.has(f));
      const isCandidateEligible = hasHotspot ? uniqueFiles.length >= 2 : uniqueFiles.length >= minFiles;
      if (!isCandidateEligible) continue;

      const impactScore = uniqueFiles.length * (hasHotspot ? 3 : 1.5) + bucket.occurrences.length;

      let label = 'Recurring Pattern';
      let suggestedCapsule = 'm-shared-capsule';
      let recommendation = 'Extract canonical capsule before decomposing consumers';

      if (bucket.type === 'STATE_UNION') {
        label = `Shared State Machine (${bucket.detail})`;
        suggestedCapsule = 'types/state.d.ts';
        recommendation = 'Extract shared discriminated union into domain types to eliminate duplicate definitions';
      } else if (bucket.type === 'UI_STRUCTURE') {
        const categorization = categorizeUiStructure(bucket.detail);
        label = categorization.label;
        suggestedCapsule = categorization.suggestedCapsule;
        recommendation = categorization.recommendation;
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
        uniqueFiles,
        occurrences: bucket.occurrences
      });
    }

    return candidates.sort((a, b) => b.impactScore - a.impactScore).slice(0, 12);
  };

  return { record, resolveHarmonizationCandidates };
};

export const categorizeUiStructure = (signature = '') => {
  const normalized = signature.toLowerCase();

  const isSvg =
    normalized.startsWith('svg>') ||
    normalized.includes('path+path') ||
    normalized.includes('polygon') ||
    normalized.includes('circle');
  if (isSvg) {
    const isMultiLayer = (normalized.match(/path|circle|rect|polygon|g/g) || []).length > 3;
    return {
      label: `Shared Vector Glyph (${signature})`,
      suggestedCapsule: isMultiLayer ? 'm-vector-glyph' : 'a-icon',
      recommendation: 'Extract foundational icon atom or vector glyph capsule'
    };
  }

  const hasButton =
    normalized.includes('btn') ||
    normalized.includes('button');
  if (hasButton) {
    const hasTextOrTitle =
      normalized.includes('span') ||
      normalized.includes('title') ||
      normalized.includes('h1') ||
      normalized.includes('h2') ||
      normalized.includes('h3') ||
      normalized.includes('h4') ||
      normalized.includes('p');

    if (hasTextOrTitle) {
      return {
        label: `Shared Action Header (${signature})`,
        suggestedCapsule: 'm-action-header',
        recommendation: 'Extract action header molecule capsule to standardize button actions'
      };
    }

    return {
      label: `Shared Button Row (${signature})`,
      suggestedCapsule: 'm-button-row',
      recommendation: 'Extract button row molecule capsule to consolidate action bar'
    };
  }

  const hasChipOrBadge =
    normalized.includes('chip') ||
    normalized.includes('badge') ||
    normalized.includes('pill') ||
    normalized.includes('tag');
  if (hasChipOrBadge) {
    const chipCount = (normalized.match(/chip|badge|pill|tag/g) || []).length;
    const isPillRow = chipCount > 1;
    if (isPillRow) {
      return {
        label: `Shared Pill Row (${signature})`,
        suggestedCapsule: 'm-pill-row',
        recommendation: 'Extract pill row molecule capsule to group status indicators'
      };
    }

    return {
      label: `Shared Status Badge (${signature})`,
      suggestedCapsule: 'm-status-badge',
      recommendation: 'Extract status badge atom or capsule to unify state tags'
    };
  }

  const hasFormInput =
    normalized.includes('input') ||
    normalized.includes('textarea') ||
    normalized.includes('select');
  if (hasFormInput) {
    return {
      label: `Shared Form Field (${signature})`,
      suggestedCapsule: 'm-form-field',
      recommendation: 'Extract form field molecule encapsulating label and input atom'
    };
  }

  return {
    label: `Shared UI Layout Structure (${signature})`,
    suggestedCapsule: 'm-feature-card',
    recommendation: 'Extract canonical molecule capsule before slicing consumer monoliths'
  };
};

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

export const extractTemplateTokens = (html) => {
  const tokens = [];
  let i = 0;
  let line = 1;

  while (i < html.length) {
    const isLineBreak = html[i] === '\n';
    if (isLineBreak) {
      line++;
      i++;
      continue;
    }

    const isCommentStart = html.startsWith('<!--', i);
    if (isCommentStart) {
      const endComment = html.indexOf('-->', i + 4);
      const isUnterminatedComment = endComment === -1;
      if (isUnterminatedComment) break;
      for (let c = i; c < endComment + 3; c++) {
        const isCommentLineBreak = html[c] === '\n';
        if (isCommentLineBreak) line++;
      }
      i = endComment + 3;
      continue;
    }

    const isTagStart = html[i] === '<';
    if (isTagStart) {
      const tagLine = line;
      let j = i + 1;
      const isClosing = html[j] === '/';
      if (isClosing) j++;

      const nameStart = j;
      while (j < html.length && /[a-zA-Z0-9_-]/.test(html[j])) {
        j++;
      }
      const tagName = html.slice(nameStart, j);

      if (tagName) {
        let isSelfClosing = false;
        let inQuote = null;

        while (j < html.length) {
          const ch = html[j];
          const isTagLineBreak = ch === '\n';
          if (isTagLineBreak) line++;

          if (inQuote) {
            const isClosingQuote = ch === inQuote && html[j - 1] !== '\\';
            if (isClosingQuote) {
              inQuote = null;
            }
          } else {
            if (ch === '"' || ch === "'") {
              inQuote = ch;
            } else if (ch === '/' && html[j + 1] === '>') {
              isSelfClosing = true;
              j += 2;
              break;
            } else if (ch === '>') {
              j++;
              break;
            }
          }
          j++;
        }

        const isVoid = VOID_ELEMENTS.has(tagName.toLowerCase());
        tokens.push({
          tag: tagName,
          isClosing,
          isSelfClosing: isSelfClosing || isVoid,
          line: tagLine
        });

        i = j;
        continue;
      }
    }

    i++;
  }

  return tokens;
};

export const buildTagTree = (tokens) => {
  const root = { tag: 'ROOT', line: 1, children: [] };
  const stack = [root];

  for (const token of tokens) {
    if (token.isClosing) {
      for (let s = stack.length - 1; s > 0; s--) {
        const isMatchingOpen = stack[s].tag === token.tag;
        if (isMatchingOpen) {
          stack.length = s;
          break;
        }
      }
    } else {
      const node = { tag: token.tag, line: token.line, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!token.isSelfClosing) {
        stack.push(node);
      }
    }
  }

  return root.children;
};

const getHierarchy = (node, depth = 0) => {
  const isBeyondDepth = depth > 2 || !node;
  if (isBeyondDepth) return '';
  const childHierarchy = (node.children || [])
    .map((c) => getHierarchy(c, depth + 1))
    .filter(Boolean);
  const isLeaf = childHierarchy.length === 0;
  if (isLeaf) return node.tag;
  return `${node.tag}>(${childHierarchy.join('+')})`;
};

export const recordTemplatePatterns = (registry, templateHtml, relativePath, startLineOffset = 0) => {
  const hasTemplateInput = Boolean(registry && templateHtml);
  if (!hasTemplateInput) return;
  const tokens = extractTemplateTokens(templateHtml);
  const nodes = buildTagTree(tokens);

  const traverseNodes = (nodeList) => {
    for (const node of nodeList) {
      const hasEnoughChildren = Boolean(node.children && node.children.length >= MIN_CHILD_NODES);
      if (hasEnoughChildren) {
        const hierarchy = getHierarchy(node);
        const isNestedHierarchy = Boolean(hierarchy && hierarchy.includes('>'));
        if (isNestedHierarchy) {
          registry.record('UI_STRUCTURE', hierarchy, {
            filePath: relativePath,
            line: node.line + startLineOffset,
            detail: hierarchy
          });
        }
      }
      const hasChildren = Boolean(node.children && node.children.length > 0);
      if (hasChildren) {
        traverseNodes(node.children);
      }
    }
  };

  traverseNodes(nodes);
};


export const createPatternVisitors = (registry, relativePath) => {
  if (!registry) return {};

  const getJsxTagName = (node) => {
    const hasOpeningElement = Boolean(node && node.openingElement);
    if (!hasOpeningElement) return null;
    const nameNode = node.openingElement.name;
    const isIdentifierName = nameNode.type === 'JSXIdentifier';
    if (isIdentifierName) return nameNode.name;
    const isMemberName = nameNode.type === 'JSXMemberExpression';
    if (isMemberName) return `${nameNode.object.name}.${nameNode.property.name}`;
    return null;
  };

  const getJsxHierarchy = (node, depth = 0) => {
    const isOutsideJsxDepth = depth > 2 || !node || node.type !== 'JSXElement';
    if (isOutsideJsxDepth) return '';
    const tag = getJsxTagName(node);
    if (!tag) return '';

    const elementChildren = (node.children || [])
      .filter((c) => c.type === 'JSXElement')
      .map((c) => getJsxHierarchy(c, depth + 1))
      .filter(Boolean);

    const isLeaf = elementChildren.length === 0;
    if (isLeaf) return tag;
    return `${tag}>(${elementChildren.join('+')})`;
  };

  return {
    TSTypeAliasDeclaration(path) {
      const typeAnnotation = path.node.typeAnnotation;
      const isUnionType = Boolean(typeAnnotation && typeAnnotation.type === 'TSUnionType');
      if (isUnionType) {
        const literals = (typeAnnotation.types || [])
          .filter((t) => t.type === 'TSLiteralType' && typeof t.literal?.value === 'string')
          .map((t) => `'${t.literal.value}'`);

        const hasEnoughMembers = literals.length >= MIN_UNION_MEMBERS;
        if (hasEnoughMembers) {
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
      const hasEnoughChildren = directElementChildren.length >= MIN_CHILD_NODES;
      if (hasEnoughChildren) {
        const hierarchy = getJsxHierarchy(path.node);
        const isNestedHierarchy = Boolean(hierarchy && hierarchy.includes('>'));
        if (isNestedHierarchy) {
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
      const isCompoundPredicate = clauseCount >= 3;
      if (isCompoundPredicate) {
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
      const functionNode = functionParent?.node;
      const fnName = functionNode?.id?.name;
      const isHook = fnName && /^use[A-Z]/.test(fnName);

      const returnsHookObject = Boolean(isHook && path.node.argument && path.node.argument.type === 'ObjectExpression');
      if (returnsHookObject) {
        const props = (path.node.argument.properties || [])
          .filter((p) => p.type === 'ObjectProperty' && p.key?.name)
          .map((p) => p.key.name);

        const hasSignature = props.length >= 3;
        if (hasSignature) {
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
