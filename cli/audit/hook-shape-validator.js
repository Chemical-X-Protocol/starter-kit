import * as t from '@babel/types';
import { RULE_REGISTRY } from './rules-registry.js';

const VERB_PREFIX_REGEX = /^(add|remove|toggle|set|get|fetch|load|save|delete|clear|reset|refresh|update|create|edit|send|sync|init|dispose|trigger|post|put|patch|apply|dismiss|select|deselect|filter|sort|search|open|close|show|hide|start|stop|cancel|execute|run|retry|submit|validate|mutate|next|prev|step|increment|decrement|insert|upsert|drop|enable|disable|register|unregister|login|logout|checkout|publish|archive|discard|confirm|undo|redo|claim|complete|acquire|release|download|upload|export|import|handle)([A-Z0-9_].*)?$/;

const STATUS_HEURISTIC_REGEX = /^(is[A-Z]|has[A-Z]|can[A-Z]|should[A-Z])|.*(Error|Status)$/;
const STATUS_EXACT_NAMES = new Set(['status', 'error', 'loading', 'pending', 'ready']);
const ACTION_WRAPPER_KEYS = new Set(['actions', 'handlers', 'methods', 'operations']);

const RAW_DOM_REF_REGEX = /^(dom|element|container|input|button|target|root|node)?Ref$|.*(Element|Node|Dom)Ref$/i;
const INTERMEDIATE_VAL_REGEX = /^(temp|draft|raw|partial|interim|scratch|memoized)([A-Z_].*)?$/i;
const UNGROUPED_CALLBACK_REGEX = /^(on[A-Z]|callback$|.*Callback$)/;

const MUTUALLY_EXCLUSIVE_STATUSES = new Set([
  'isloading', 'issuccess', 'iserror', 'isidle', 'isloaded', 'isfetching', 'ispending',
  'loading', 'success', 'idle'
]);

export const SEMANTIC_STATUS_CLUSTERS = {
  LOADING: {
    canonical: 'isLoading',
    variants: new Set(['isloading', 'loading', 'ispending', 'pending', 'isfetching', 'fetching'])
  },
  ERROR: {
    canonical: 'error',
    variants: new Set(['error', 'iserror', 'haserror', 'err', 'errormessage'])
  },
  READY: {
    canonical: 'isReady',
    variants: new Set(['isready', 'ready', 'isinitialized', 'initialized'])
  },
  STATUS: {
    canonical: 'status',
    variants: new Set(['status', 'state', 'phase', 'stage'])
  }
};

const resolvePropKey = (prop) => {
  if (t.isIdentifier(prop.key)) return prop.key.name;
  if (t.isStringLiteral(prop.key)) return prop.key.value;
  return null;
};

const isFunctionNode = (node, scope) => {
  const isDirectFunction = t.isArrowFunctionExpression(node) || t.isFunctionExpression(node);
  if (isDirectFunction) return true;

  const isIdentifierNode = t.isIdentifier(node);
  const canInspectScope = isIdentifierNode && Boolean(scope);
  if (!canInspectScope) return false;

  const binding = scope.getBinding(node.name);
  if (!binding) return false;

  if (binding.path.isFunctionDeclaration()) return true;

  if (binding.path.isVariableDeclarator()) {
    const init = binding.path.node.init;
    const isInitFunction = t.isArrowFunctionExpression(init) || t.isFunctionExpression(init);
    if (isInitFunction) return true;
    const isCallbackHook = t.isCallExpression(init) && t.isIdentifier(init.callee, { name: 'useCallback' });
    if (isCallbackHook) return true;
  }

  return false;
};

const hasNestedActions = (objectExpr, scope) => {
  if (!t.isObjectExpression(objectExpr)) return false;
  return objectExpr.properties.some((p) => {
    if (t.isObjectMethod(p)) return true;
    if (t.isObjectProperty(p)) {
      const name = resolvePropKey(p);
      const isVerbNamed = Boolean(name && VERB_PREFIX_REGEX.test(name));
      if (isVerbNamed) return true;
      if (isFunctionNode(p.value, scope)) return true;
    }
    return false;
  });
};

export const createHookShapeRegistry = () => {
  const entries = [];

  const recordHook = (hookInfo) => {
    entries.push(hookInfo);
  };

  const validateCrossHookConsistency = () => {
    const consistencyViolations = [];
    if (entries.length < 2) return consistencyViolations;

    for (const [clusterKey, cluster] of Object.entries(SEMANTIC_STATUS_CLUSTERS)) {
      const occurrences = [];
      for (const entry of entries) {
        for (const prop of entry.statusProps) {
          const lower = prop.name.toLowerCase();
          if (cluster.variants.has(lower)) {
            occurrences.push({ ...prop, hookName: entry.hookName, filePath: entry.filePath });
          }
        }
      }

      const uniqueNames = Array.from(new Set(occurrences.map((o) => o.name)));
      if (uniqueNames.length > 1) {
        for (const occ of occurrences) {
          if (occ.name !== cluster.canonical) {
            const meta = RULE_REGISTRY.HOOK_SHAPE_CONTRACT;
            consistencyViolations.push({
              filePath: occ.filePath,
              line: occ.line,
              column: occ.column,
              hazard: `Inconsistent ${clusterKey.toLowerCase()} status property "${occ.name}". Rename to "${cluster.canonical}" to match hook shape conventions.`,
              rule: 'HOOK_SHAPE_CONTRACT',
              severity: meta.severity,
              pillar: meta.pillar,
              directive: meta.directive
            });
          }
        }
      }
    }

    return consistencyViolations;
  };

  return { recordHook, validateCrossHookConsistency, entries };
};

export const validateHookReturnShape = ({ retPath, astPath, relativePath, violations, hookRegistry }) => {
  if (!t.isObjectExpression(retPath.node.argument)) return;

  const properties = retPath.node.argument.properties;
  const propCount = properties.length;
  const hookName = astPath.node.id?.name || astPath.parentPath?.node?.id?.name || 'anonymousHook';
  const meta = RULE_REGISTRY.HOOK_SHAPE_CONTRACT;
  const overloadMeta = RULE_REGISTRY.HOOK_RETURN_OVERLOAD;

  if (propCount > 5) {
    violations.push({
      filePath: relativePath,
      line: retPath.node.loc?.start.line || 1,
      column: retPath.node.loc?.start.column || 1,
      hazard: `Hook return saturation (${propCount} properties > 5 limit; deprecated rule: migrate to HOOK_SHAPE_CONTRACT)`,
      rule: 'HOOK_RETURN_OVERLOAD',
      severity: overloadMeta.severity,
      pillar: overloadMeta.pillar,
      directive: overloadMeta.directive
    });
  }

  const statusProps = [];
  const mutualStatuses = [];

  for (const prop of properties) {
    if (t.isSpreadElement(prop)) continue;

    const keyName = resolvePropKey(prop);
    if (!keyName) continue;

    const line = prop.loc?.start.line || retPath.node.loc?.start.line || 1;
    const column = prop.loc?.start.column || retPath.node.loc?.start.column || 1;

    const isActionWrapperKey = ACTION_WRAPPER_KEYS.has(keyName);
    if (isActionWrapperKey) {
      violations.push({
        filePath: relativePath,
        line,
        column,
        hazard: `Nested action wrapper detected in hook return ("${keyName}"). Actions must be flat at top level per HOOK_SHAPE_CONTRACT.`,
        rule: 'HOOK_SHAPE_CONTRACT',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
      continue;
    }

    const isPropObject = t.isObjectProperty(prop) && hasNestedActions(prop.value, astPath.scope);
    if (isPropObject) {
      violations.push({
        filePath: relativePath,
        line,
        column,
        hazard: `Action wrapper detected in property "${keyName}". Actions must be flat at top level per HOOK_SHAPE_CONTRACT.`,
        rule: 'HOOK_SHAPE_CONTRACT',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
      continue;
    }

    const isMethod = t.isObjectMethod(prop);
    const isPropFunc = t.isObjectProperty(prop) && isFunctionNode(prop.value, astPath.scope);
    const isFunction = isMethod || isPropFunc;

    if (isFunction) {
      const isStatusPredicate = STATUS_HEURISTIC_REGEX.test(keyName);
      if (isStatusPredicate) {
        statusProps.push({ name: keyName, line, column });
        if (MUTUALLY_EXCLUSIVE_STATUSES.has(keyName.toLowerCase())) {
          mutualStatuses.push(keyName);
        }
        continue;
      }

      const isUngrouped = UNGROUPED_CALLBACK_REGEX.test(keyName);
      if (isUngrouped) {
        violations.push({
          filePath: relativePath,
          line,
          column,
          hazard: `Property "${keyName}" is an invalid hook action. Actions must be verb-prefixed (e.g. addItem, toggleItem) rather than event handlers or callbacks.`,
          rule: 'HOOK_SHAPE_CONTRACT',
          severity: meta.severity,
          pillar: meta.pillar,
          directive: meta.directive
        });
      } else {
        const isVerbPrefixed = VERB_PREFIX_REGEX.test(keyName);
        if (!isVerbPrefixed) {
          violations.push({
            filePath: relativePath,
            line,
            column,
            hazard: `Function "${keyName}" in hook return is missing an action verb prefix (e.g. addItem, toggleItem).`,
            rule: 'HOOK_SHAPE_CONTRACT',
            severity: meta.severity,
            pillar: meta.pillar,
            directive: meta.directive
          });
        }
      }
      continue;
    }

    const isDomRef = RAW_DOM_REF_REGEX.test(keyName) || keyName === 'ref';
    if (isDomRef) {
      violations.push({
        filePath: relativePath,
        line,
        column,
        hazard: `Property "${keyName}" is a raw DOM ref. Hooks must not return raw DOM element refs.`,
        rule: 'HOOK_SHAPE_CONTRACT',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
      continue;
    }

    const isIntermediate = INTERMEDIATE_VAL_REGEX.test(keyName);
    if (isIntermediate) {
      violations.push({
        filePath: relativePath,
        line,
        column,
        hazard: `Property "${keyName}" is an intermediate or temporary value. Hooks must return finished domain state.`,
        rule: 'HOOK_SHAPE_CONTRACT',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
      continue;
    }

    const isCallback = UNGROUPED_CALLBACK_REGEX.test(keyName);
    if (isCallback) {
      violations.push({
        filePath: relativePath,
        line,
        column,
        hazard: `Property "${keyName}" is an ungrouped callback or handler. Actions must be verb-prefixed (e.g. addItem).`,
        rule: 'HOOK_SHAPE_CONTRACT',
        severity: meta.severity,
        pillar: meta.pillar,
        directive: meta.directive
      });
      continue;
    }

    const isStatus = STATUS_HEURISTIC_REGEX.test(keyName) || STATUS_EXACT_NAMES.has(keyName.toLowerCase());
    if (isStatus) {
      statusProps.push({ name: keyName, line, column });
      if (MUTUALLY_EXCLUSIVE_STATUSES.has(keyName.toLowerCase())) {
        mutualStatuses.push(keyName);
      }
    }
  }

  if (mutualStatuses.length >= 3) {
    violations.push({
      filePath: relativePath,
      line: retPath.node.loc?.start.line || 1,
      column: retPath.node.loc?.start.column || 1,
      hazard: `Mutually exclusive lifecycle states returned as multiple independent booleans (${mutualStatuses.join(', ')}). Prefer a single discriminated status field per Directive 2.B.`,
      rule: 'HOOK_SHAPE_CONTRACT',
      severity: meta.severity,
      pillar: meta.pillar,
      directive: meta.directive
    });
  }

  if (hookRegistry) {
    hookRegistry.recordHook({
      hookName,
      filePath: relativePath,
      statusProps
    });
  }
};
