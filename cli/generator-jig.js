import fs from 'node:fs';
import path from 'node:path';
import { toPascalCase, toCamelCase } from './generator-templates/naming.js';
import { detectTestRunner, detectJigBaseDir } from './project-detector.js';
import { indexGeneratedFiles } from './generator-indexer.js';

export const JIG_KINDS = new Set([
  'service',
  'route',
  'endpoint',
  'store',
  'repo',
  'repository',
  'util',
  'utility',
  'spec'
]);

export const normalizeJigKind = (rawKind = '') => {
  const norm = String(rawKind).trim().toLowerCase();
  if (norm === 'endpoint') return 'route';
  if (norm === 'repository') return 'repo';
  if (norm === 'utility') return 'util';
  if (JIG_KINDS.has(norm)) return norm;
  return 'service';
};

const normalizeMethods = (rawMethods) => {
  if (!rawMethods) return [];
  if (Array.isArray(rawMethods)) {
    return rawMethods.map((m) => {
      if (typeof m === 'string') {
        const match = m.match(/^([a-zA-Z0-9_]+)(?:\(([^)]*)\))?(?::\s*([a-zA-Z0-9_<>[\]]+))?$/);
        if (match) {
          return { name: match[1], params: match[2] || '', returnType: match[3] || 'Promise<ResultTuple<any>>', isAsync: true };
        }
        return { name: m.trim(), params: '', returnType: 'Promise<ResultTuple<any>>', isAsync: true };
      }
      return {
        name: m.name || 'execute',
        params: m.params || '',
        returnType: m.returnType || (m.isAsync !== false ? 'Promise<ResultTuple<any>>' : 'ResultTuple<any>'),
        isAsync: m.isAsync !== false
      };
    });
  }
  if (typeof rawMethods === 'string') {
    return rawMethods.split(',').map((s) => s.trim()).filter(Boolean).map((name) => ({
      name,
      params: '',
      returnType: 'Promise<ResultTuple<any>>',
      isAsync: true
    }));
  }
  return [];
};

const normalizeState = (rawState) => {
  if (!rawState) return [];
  const list = Array.isArray(rawState) ? rawState : (typeof rawState === 'string' ? rawState.split(',') : []);
  return list.map((item) => {
    if (typeof item === 'object' && item !== null && item.name) {
      return { name: item.name, type: item.type || 'string', default: item.default ?? 'null' };
    }
    const parts = String(item).split(':').map((p) => p.trim());
    return { name: parts[0], type: parts[1] || 'string', default: parts[2] || 'null' };
  }).filter((s) => Boolean(s.name));
};

const normalizeRoutes = (rawRoutes) => {
  if (!rawRoutes) return [];
  const list = Array.isArray(rawRoutes) ? rawRoutes : (typeof rawRoutes === 'string' ? rawRoutes.split(',') : []);
  return list.map((r) => {
    if (typeof r === 'object' && r !== null && r.method) {
      return { method: r.method.toUpperCase(), path: r.path || '/' };
    }
    const parts = String(r).trim().split(/\s+/).map((p) => p.trim());
    if (parts.length >= 2) return { method: parts[0].toUpperCase(), path: parts[1] };
    return { method: 'GET', path: parts[0] || '/' };
  }).filter((r) => Boolean(r.method && r.path));
};

// ---------------------------------------------------------------------------
// Builders for Code, Types, and Specs (<100 LOC per file guarantee)
// ---------------------------------------------------------------------------

const buildServiceFiles = ({ name, pascalName, camelName, methods, desc, runner }) => {
  const methodList = methods.length > 0 ? methods : [
    { name: `get${pascalName}`, params: 'id: string', returnType: `Promise<ResultTuple<${pascalName}Record | null>>`, isAsync: true },
    { name: `save${pascalName}`, params: `record: ${pascalName}Input`, returnType: `Promise<ResultTuple<${pascalName}Record>>`, isAsync: true }
  ];

  const codeLines = [
    `/**`,
    ` * ${pascalName} Service`,
    ` * ${desc || 'Domain service with Result tuple error handling'}`,
    ` */`,
    `import type { ResultTuple, ${pascalName}Record, ${pascalName}Input } from './${name}.types';`,
    ``,
    `export class ${pascalName}Service {`,
    `  private readonly baseUrl: string;`,
    ``,
    `  constructor(baseUrl: string = '') {`,
    `    this.baseUrl = baseUrl;`,
    `  }`,
    ``
  ];

  for (const m of methodList) {
    const asyncKw = m.isAsync ? 'async ' : '';
    codeLines.push(`  ${asyncKw}${m.name}(${m.params}): ${m.returnType} {`);
    codeLines.push(`    const isReady = Boolean(this.baseUrl !== undefined);`);
    codeLines.push(`    if (!isReady) return [null, new Error('${pascalName}Service not configured')];`);
    codeLines.push(`    return [null, null];`);
    codeLines.push(`  }`);
    codeLines.push(``);
  }

  codeLines.push(`}`);
  codeLines.push(``);
  codeLines.push(`export const create${pascalName}Service = (baseUrl?: string): ${pascalName}Service => {`);
  codeLines.push(`  return new ${pascalName}Service(baseUrl);`);
  codeLines.push(`};`);

  const typesLines = [
    `export type ResultTuple<T, E = Error> = [T, null] | [null, E];`,
    ``,
    `export interface ${pascalName}Record {`,
    `  readonly id: string;`,
    `  readonly createdAt: number;`,
    `}`,
    ``,
    `export interface ${pascalName}Input {`,
    `  readonly label: string;`,
    `}`
  ];

  const isVitest = runner === 'vitest';
  const testImport = isVitest ? `import { describe, it, expect } from 'vitest';` : `import { describe, it } from 'node:test';\nimport assert from 'node:assert';`;

  const specLines = [
    testImport,
    `import { create${pascalName}Service } from './${name}';`,
    ``,
    `describe('${pascalName}Service', () => {`,
    `  it('instantiates service cleanly', () => {`,
    `    const service = create${pascalName}Service('https://api.local');`,
    isVitest ? `    expect(service).toBeDefined();` : `    assert.ok(service);`,
    `  });`,
    ``,
    `  it('executes primary method with Result tuple guard', async () => {`,
    `    const service = create${pascalName}Service();`,
    `    const [data, err] = await service.${methodList[0].name}('test-id');`,
    isVitest ? `    expect(err).toBeNull();` : `    assert.strictEqual(err, null);`,
    `  });`,
    `});`
  ];

  return {
    code: codeLines.join('\n') + '\n',
    types: typesLines.join('\n') + '\n',
    spec: specLines.join('\n') + '\n'
  };
};

const buildRouteFiles = ({ name, pascalName, routes, desc, runner }) => {
  const routeList = routes.length > 0 ? routes : [
    { method: 'GET', path: `/${name}` },
    { method: 'POST', path: `/${name}` }
  ];

  const codeLines = [
    `/**`,
    ` * ${pascalName} API Route Handlers`,
    ` * ${desc || 'HTTP Route handler with early guard returns and typed envelopes'}`,
    ` */`,
    `export type RouteResult<T> = { status: number; body: { ok: boolean; data?: T; error?: string } };`,
    ``
  ];

  for (const r of routeList) {
    const fnName = `handle${r.method}${pascalName}`;
    codeLines.push(`export const ${fnName} = async (req: { params?: Record<string, string>; body?: unknown }): Promise<RouteResult<unknown>> => {`);
    codeLines.push(`  const hasPayload = Boolean(req);`);
    codeLines.push(`  if (!hasPayload) {`);
    codeLines.push(`    return { status: 400, body: { ok: false, error: 'Invalid request' } };`);
    codeLines.push(`  }`);
    codeLines.push(`  return { status: 200, body: { ok: true, data: null } };`);
    codeLines.push(`};`);
    codeLines.push(``);
  }

  const isVitest = runner === 'vitest';
  const testImport = isVitest ? `import { describe, it, expect } from 'vitest';` : `import { describe, it } from 'node:test';\nimport assert from 'node:assert';`;

  const specLines = [
    testImport,
    `import { handle${routeList[0].method}${pascalName} } from './${name}';`,
    ``,
    `describe('${pascalName} Routes', () => {`,
    `  it('handles ${routeList[0].method} successfully', async () => {`,
    `    const res = await handle${routeList[0].method}${pascalName}({ body: {} });`,
    isVitest ? `    expect(res.status).toBe(200);` : `    assert.strictEqual(res.status, 200);`,
    isVitest ? `    expect(res.body.ok).toBe(true);` : `    assert.strictEqual(res.body.ok, true);`,
    `  });`,
    `});`
  ];

  return {
    code: codeLines.join('\n') + '\n',
    types: null,
    spec: specLines.join('\n') + '\n'
  };
};

const buildStoreFiles = ({ name, pascalName, state, desc, runner }) => {
  const stateProps = state.length > 0 ? state : [
    { name: 'records', type: 'string[]', default: '[]' }
  ];

  const codeLines = [
    `/**`,
    ` * ${pascalName} Store Slice`,
    ` * ${desc || 'Reactive store with discriminated union states and immutable actions'}`,
    ` */`,
    `export type ${pascalName}State =`,
    `  | { readonly status: 'idle'; readonly data: null }`,
    `  | { readonly status: 'loading'; readonly data: null }`,
    `  | { readonly status: 'active'; readonly data: { ${stateProps.map(s => `${s.name}: ${s.type}`).join('; ')} } }`,
    `  | { readonly status: 'fault'; readonly error: string };`,
    ``,
    `export const createInitial${pascalName}State = (): ${pascalName}State => ({`,
    `  status: 'idle',`,
    `  data: null`,
    `});`,
    ``,
    `export const transitionToActive = (payload: { ${stateProps.map(s => `${s.name}: ${s.type}`).join('; ')} }): ${pascalName}State => {`,
    `  const isValid = Boolean(payload);`,
    `  if (!isValid) return { status: 'fault', error: 'Invalid state payload' };`,
    `  return { status: 'active', data: payload };`,
    `};`
  ];

  const isVitest = runner === 'vitest';
  const testImport = isVitest ? `import { describe, it, expect } from 'vitest';` : `import { describe, it } from 'node:test';\nimport assert from 'node:assert';`;

  const specLines = [
    testImport,
    `import { createInitial${pascalName}State, transitionToActive } from './${name}';`,
    ``,
    `describe('${pascalName} Store', () => {`,
    `  it('creates initial idle state', () => {`,
    `    const initial = createInitial${pascalName}State();`,
    isVitest ? `    expect(initial.status).toBe('idle');` : `    assert.strictEqual(initial.status, 'idle');`,
    `  });`,
    ``,
    `  it('transitions to active with payload', () => {`,
    `    const next = transitionToActive({ ${stateProps.map(s => `${s.name}: ${s.default}`).join(', ')} });`,
    isVitest ? `    expect(next.status).toBe('active');` : `    assert.strictEqual(next.status, 'active');`,
    `  });`,
    `});`
  ];

  return {
    code: codeLines.join('\n') + '\n',
    types: null,
    spec: specLines.join('\n') + '\n'
  };
};

const buildRepoFiles = ({ name, pascalName, desc, runner }) => {
  const codeLines = [
    `/**`,
    ` * ${pascalName} Repository`,
    ` * ${desc || 'Data access repository with Result tuple error handling'}`,
    ` */`,
    `export type ResultTuple<T, E = Error> = [T, null] | [null, E];`,
    ``,
    `export class ${pascalName}Repository {`,
    `  private readonly db: any;`,
    ``,
    `  constructor(db: any = null) {`,
    `    this.db = db;`,
    `  }`,
    ``,
    `  async findById(id: string): Promise<ResultTuple<any | null>> {`,
    `    const hasId = Boolean(id && id.trim());`,
    `    if (!hasId) return [null, new Error('Valid id required')];`,
    `    return [null, null];`,
    `  }`,
    ``,
    `  async insert(entity: Record<string, unknown>): Promise<ResultTuple<boolean>> {`,
    `    const hasEntity = Boolean(entity && typeof entity === 'object');`,
    `    if (!hasEntity) return [null, new Error('Valid entity required')];`,
    `    return [true, null];`,
    `  }`,
    `}`
  ];

  const isVitest = runner === 'vitest';
  const testImport = isVitest ? `import { describe, it, expect } from 'vitest';` : `import { describe, it } from 'node:test';\nimport assert from 'node:assert';`;

  const specLines = [
    testImport,
    `import { ${pascalName}Repository } from './${name}';`,
    ``,
    `describe('${pascalName}Repository', () => {`,
    `  it('instantiates repository cleanly', () => {`,
    `    const repo = new ${pascalName}Repository();`,
    isVitest ? `    expect(repo).toBeDefined();` : `    assert.ok(repo);`,
    `  });`,
    `});`
  ];

  return {
    code: codeLines.join('\n') + '\n',
    types: null,
    spec: specLines.join('\n') + '\n'
  };
};

const buildUtilFiles = ({ name, pascalName, methods, desc, runner }) => {
  const methodList = methods.length > 0 ? methods : [
    { name: `format${pascalName}`, params: 'value: unknown', returnType: 'string' }
  ];

  const codeLines = [
    `/**`,
    ` * ${pascalName} Utilities`,
    ` * ${desc || 'Pure stateless functions'}`,
    ` */`,
    ``
  ];

  for (const m of methodList) {
    codeLines.push(`export const ${m.name} = (${m.params}): ${m.returnType} => {`);
    codeLines.push(`  const hasInput = arguments.length > 0;`);
    codeLines.push(`  if (!hasInput) return '';`);
    codeLines.push(`  return String(arguments[0] ?? '');`);
    codeLines.push(`};`);
    codeLines.push(``);
  }

  const isVitest = runner === 'vitest';
  const testImport = isVitest ? `import { describe, it, expect } from 'vitest';` : `import { describe, it } from 'node:test';\nimport assert from 'node:assert';`;

  const specLines = [
    testImport,
    `import { ${methodList[0].name} } from './${name}';`,
    ``,
    `describe('${pascalName} Utilities', () => {`,
    `  it('executes ${methodList[0].name} reliably', () => {`,
    `    const result = ${methodList[0].name}('sample');`,
    isVitest ? `    expect(typeof result).toBe('string');` : `    assert.strictEqual(typeof result, 'string');`,
    `  });`,
    `});`
  ];

  return {
    code: codeLines.join('\n') + '\n',
    types: null,
    spec: specLines.join('\n') + '\n'
  };
};

const buildSpecOnlyFile = ({ name, pascalName, runner }) => {
  const isVitest = runner === 'vitest';
  const testImport = isVitest ? `import { describe, it, expect } from 'vitest';` : `import { describe, it } from 'node:test';\nimport assert from 'node:assert';`;

  const specLines = [
    testImport,
    ``,
    `describe('${pascalName}', () => {`,
    `  it('satisfies basic invariants', () => {`,
    isVitest ? `    expect(true).toBe(true);` : `    assert.strictEqual(true, true);`,
    `  });`,
    `});`
  ];

  return {
    code: null,
    types: null,
    spec: specLines.join('\n') + '\n'
  };
};

// ---------------------------------------------------------------------------
// Main createJigFiles Orchestrator
// ---------------------------------------------------------------------------

export const createJigFiles = ({
  kind = 'service',
  name = 'sample-service',
  targetParent = null,
  dir = null,
  preset = null,
  methods = [],
  state = [],
  routes = [],
  schema = null,
  desc = '',
  description = '',
  dryRun = false,
  cwd = process.cwd()
} = {}) => {
  const normKind = normalizeJigKind(kind);
  let cleanName = String(name || `sample-${normKind}`).trim().toLowerCase();
  const kindPrefix = new RegExp(`^${normKind}-`);
  cleanName = cleanName.replace(kindPrefix, '');
  const slug = `${normKind}-${cleanName}`;
  const pascalName = toPascalCase(cleanName);
  const camelName = toCamelCase(cleanName);
  const parsedMethods = normalizeMethods(methods);
  const parsedState = normalizeState(state);
  const parsedRoutes = normalizeRoutes(routes);
  const finalDesc = desc || description || '';

  const detectedDir = detectJigBaseDir(normKind, { cwd, preset });
  const chosenDir = dir || targetParent || detectedDir;
  const resolvedTargetDir = path.resolve(cwd, chosenDir);
  const runner = detectTestRunner(cwd);

  let builtFiles = null;
  if (normKind === 'service') {
    builtFiles = buildServiceFiles({ name: slug, pascalName, camelName, methods: parsedMethods, desc: finalDesc, runner });
  } else if (normKind === 'route') {
    builtFiles = buildRouteFiles({ name: slug, pascalName, routes: parsedRoutes, desc: finalDesc, runner });
  } else if (normKind === 'store') {
    builtFiles = buildStoreFiles({ name: slug, pascalName, state: parsedState, desc: finalDesc, runner });
  } else if (normKind === 'repo') {
    builtFiles = buildRepoFiles({ name: slug, pascalName, desc: finalDesc, runner });
  } else if (normKind === 'util') {
    builtFiles = buildUtilFiles({ name: slug, pascalName, methods: parsedMethods, desc: finalDesc, runner });
  } else {
    builtFiles = buildSpecOnlyFile({ name: slug, pascalName, runner });
  }

  const filesToCreate = [];
  if (builtFiles.code) {
    filesToCreate.push({ relName: `${slug}.ts`, content: builtFiles.code });
  }
  if (builtFiles.types) {
    filesToCreate.push({ relName: `${slug}.types.d.ts`, content: builtFiles.types });
  }
  if (builtFiles.spec) {
    filesToCreate.push({ relName: `${slug}.spec.ts`, content: builtFiles.spec });
  }

  const previews = filesToCreate.map((f) => ({
    file: f.relName,
    lines: f.content.split('\n').length
  }));

  const filesCreated = filesToCreate.map((f) => f.relName);

  if (!dryRun) {
    if (!fs.existsSync(resolvedTargetDir)) {
      fs.mkdirSync(resolvedTargetDir, { recursive: true });
    }
    for (const f of filesToCreate) {
      const absPath = path.join(resolvedTargetDir, f.relName);
      fs.writeFileSync(absPath, f.content, 'utf-8');
    }
    indexGeneratedFiles(cwd, resolvedTargetDir, filesCreated);
  }

  return {
    success: true,
    jig: true,
    kind: normKind,
    name: slug,
    pascalName,
    dryRun: Boolean(dryRun),
    targetDir: resolvedTargetDir,
    relativeDir: path.relative(cwd, resolvedTargetDir),
    filesCreated,
    previews
  };
};
