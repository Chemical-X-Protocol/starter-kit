# Chemical X Molecular Architecture Directives
# Target Project: Project Quantum App

> *"Clean, literate code that reads like poetry to both humans and AI."*
> Mandatory architectural directives for AI Agents operating on Project Quantum App. Strictly enforce these standards on every code generation, refactor, and review pass.

---

## 1. The Molecular Architecture Protocol

### A. Strict Hard Line Limits & Monolith Decomposition
- **File Line Limit**: 100 lines is an outer bound, not a target. A genuinely single-purpose file (atom, molecule, hook, or controller) should typically land well under this - often 50-150 lines. Approaching 100 is itself a signal that the file has stopped being single-purpose, not a trigger to wait for.
- **Molecule Capsule Limit**: Maximum 100 lines per molecule capsule file.
- **Decomposition Trigger**: Split when you can name the new file's single responsibility on its own - not when a line counter fires. If a file is nearing 100 and no natural seam is obvious yet, that's a sign the responsibilities were already tangled before it got this big; look backward for where that happened rather than cutting at whatever line you're currently on.
- **Rationale**: Small, single-purpose files aren't just cleaner - they're cheaper to work with. Every file opened loads its full contents into context; a smaller file means less scanning, less irrelevant code loaded per task, and lower token cost per edit, compounding across a session.

### B. Table-of-Contents Views
- Top-level page views MUST NEVER contain hundreds of lines of nested DOM scaffolding.
- A view template MUST read like a clean, 10 to 20 line declarative Table of Contents assembling self-contained molecules and organisms via named slot templates (`#header`, `#default`, `#modals`).

### C. Crystalline Molecule Capsules
- Every molecule and organism lives in an isolated, self-contained directory capsule:
  ```
  m-<feature>-card/
  ├── m-<feature>-card.<ext>          (< 100 lines: declarative layout & bindings)
  ├── m-<feature>-card.controller.ts  (pure reactive state & 2-stage booleans)
  ├── _m-<feature>-card.scss          (mixin-only glass styling)
  ├── types.d.ts                      (pure Props & Emits declarations)
  └── index.ts                        (clean public entrypoint)
  ```

### D. Anti-Prop-Drilling & Domain State
- Never pass 10+ props or chained event bubbles across component tiers.
- Encapsulate shared feature state in dedicated domain composables/hooks, scoped stores, or typed provide/inject.
- Child components consume state directly from the domain composable and emit minimal, intention-revealing semantic events.

### E. Same-Name Prop Shorthand (Vue 3.4+ & Svelte 5)
- **Vue 3.4+**: Always use same-name `:prop` shorthand instead of redundant `:prop="prop"`:
  `<m-spark-kpi-strip :metrics :records :can-refresh />`
- **Svelte 5**: Always use same-name `{prop}` shorthand instead of `prop={prop}`:
  `<SparkKpiStrip {metrics} {records} {canRefresh} />`
- **React 19 (JSX)**: Explicitly bind `prop={prop}`. Never write `<Comp prop />` for variables (JSX evaluates bare attributes to boolean `true`).

### F. Pre-Split Pattern Discovery & Harmonization Protocol
- **Survey Before Slicing**: Before decomposing any monolithic file or collection of files, the AI must first conduct a cross-file pattern discovery audit across all candidate monoliths.
- **Identify Recurring Structures**: Map shared UI layouts, duplicate controllers, repeated predicates, common state machines, and mirrored type definitions across files before writing any split code.
- **Map to Existing Foundations**: Check the design system, shared atom catalog (`x-*`), central composables, and core utilities first. Never invent a bespoke one-off atom or utility if an equivalent foundation exists.
- **Canonical Extraction First**: Consolidate and extract shared atoms, molecules, or composables once into canonical capsules before splitting consumer monoliths.
- **Zero Bespoke Pattern Proliferation**: Decompose consumer monoliths by binding directly to the extracted canonical capsules, preventing the proliferation of duplicate, slightly divergent patterns across spliced views.

### G. Strict Architectural Tier Separation & The Zero-Raw-DOM Rule
- **Atoms / Foundations**: Single, foundational UI elements. (The ONLY tier where raw DOM/HTML elements like `<button>`, `<input>`, `<textarea>`, or raw layout `<div>` are permitted).
- **Molecules / Blocks**: Groups of foundational elements. (NO raw DOM elements).
- **Organisms / Modules**: Complex groupings of components. (NO raw DOM elements).
- **Templates / Layouts**: Structural blueprints for pages. (NO raw DOM elements).
- **Views / Pages**: High-level components that implement layouts and inject state.
- **Tab List Decomposition Pattern**:
  - *Anti-Pattern*: Inlining repeated raw `<button>` elements with ternary class chains and icons directly inside molecules or views.
  - *Quantum Solution*:
    1. Foundation: Encapsulate the raw `<button>` element inside a foundational Atom (`AtomButton` or `a-button`).
    2. Capsule: Encapsulate the tab button UI pattern into `m-tab-button` with scoped BEM modifier classes (e.g. `.m-tab-button--pink`, `.m-tab-button--flexible`) using `@apply`. Never place utility selector strings in JavaScript.
    3. Composition: In the consumer showcase or organism, declaratively render `<m-tab-button>` instances inside an atom surface, with zero raw HTML tags in the template.

### H. AI Agent Codebase Query Machine Protocol
- **Search First Rule**: AI agents MUST invoke `pnpm q "<query>"` (or `npx chemx search "<query>"`) before running broad ripgrep, find, or file dumping.
- **AST Architecture Intelligence**: Always leverage `pnpm q` to inspect component tiers, exported symbols, props, and hooks with minimal token burn.
- **Inspect Mode**: Use `pnpm q "<capsule-name>" --inspect` to examine props and hooks without reading entire source files into context.
- **JSON Mode**: Use `pnpm q "<query>" --json` for zero-overhead, machine-readable agent lookups.
- **Tier Filtering**: Use `pnpm q "<query>" --tier=molecule` (or `atom`, `organism`, `hook`) to narrow scope instantly.

### I. Capsule Trust-Tier Classification & Audit Escalation
- **Tier 1 (Pure / Stateless)**: Atoms, formatters, pure validators, and API client wrappers. Agents may trust exported interface contracts without inspecting internal implementation details.
- **Tier 2 (Stateful / Side-Effecting)**: Auth, payments, data mutation, session lifecycle, and transactional service layers. Declared explicitly in capsule `index.ts` metadata or capsule frontmatter (`trustTier: 2`).
- **Exemption from Shallow Interface Trust**: Tier 2 capsules are strictly exempted from "agent trusts interface, never reads implementation". Agents must inspect implementation details for state invariants and side-effect guarantees.
- **Automated Audit Escalation**: Query tools and audits automatically escalate review strictness for Tier 2 capsules, requiring deep verification of state transitions, mutation boundaries, and failure recoverability.

### J. Stateful Class & Shared Instance State Carve-Out
- **Atomic Unit Protection**: Stateful classes and services holding shared instance state across methods are treated as a single atomic unit.
- **Prohibition on Method Slicing**: Never split methods sharing internal instance state into isolated files or micro-functions. Atomization must not destroy the cohesive state machine.
- **Decomposition Protocol**: When approaching file line limits, decompose exclusively by extracting pure, stateless helper functions, mathematical derivations, and boundary validators out of the class into standalone utility capsules, preserving the class methods and instance state together.

---

## 2. Domain-Based Type Architecture & Data Integrity

### A. The Anti-Type-Monolith Rule & Domain-Scoped Capsules
- Strictly prohibit dumping thousands of unrelated entity types into a single monolithic `types.ts` or `global.d.ts`.
- Co-locate granular `types/*.d.ts` declaration files directly inside each molecule, organism, or feature directory capsule.
- Max 100 lines per domain type file. If a type file approaches 100 lines, decompose into granular domain files (`session.d.ts`, `auth.d.ts`, `billing.d.ts`).
- Root `types/*.d.ts` is reserved strictly for universal system primitives (`ResultTuple<T>`, `AsyncDataState<T>`, base envelopes). It never contains domain entity models.
- Zero runtime logic in type files. Zero implicit `any`.

### B. Discriminated State Unions (Zero Impossible States)
- Model component and session state as strict discriminated/disjoint unions in domain `types/*.d.ts` rather than multiple conflicting booleans:
  ```typescript
  export type SessionState =
    | { readonly status: 'idle' }
    | { readonly status: 'loading'; readonly progress: number }
    | { readonly status: 'active';  readonly sessionId: string }
    | { readonly status: 'fault';   readonly faultMessage: string };
  ```

### C. Result Tuple Pattern (`toResult`)
- Avoid nested `try/catch` blocks in async flows. Return Go/Rust-style `[data, error]` tuples with top-of-function early guard clauses:
  ```typescript
  const [data, fetchError] = await toResult(api.fetchEntity(id));
  if (fetchError) {
    handleError(fetchError);
    return;
  }
  initializeEntity(data);
  ```

### D. Zero Synthetic or Mock Data
- Never generate fake names, synthetic emails (`@gmail.com`), random phone numbers (`555-xxx`), mock license numbers, or fake entity arrays.
- Return genuine live API data or explicit empty states (`No records found`).

### E. Immutable State Action Boundaries
- Never mutate deep nested store properties inside child components. State transitions occur strictly through named, traceable store actions.

### F. Runtime API Boundary Guards
- External API and network payloads must be verified through pure, atomic runtime type guards before ingestion into reactive state.

### G. Backend Schema Ground-Truth Hierarchy
- **Schema as Single Source of Truth**: Backend database schemas (SQL/Prisma/migrations) and OpenAPI specifications constitute ground truth: domain types are strictly derived views.
- **Bidirectional Schema Validation**: Domain types and boundary interfaces must be validated against the active schema or OpenAPI contract rather than treated as independently authoritative.
- **Drift Prevention**: Never hand-craft unvalidated entity definitions. Mismatches in nullability, default values, or field mutations must fail compile-time checks or contract test suites before ingestion.

---

## 3. Control Flow & Self-Documenting Logic

### A. Two-Stage Atomic Boolean Composition
- Never inline complex multi-clause comparisons (`if (a === b && c > 0 && !d)`).
- Break complex checks into atomic single-concept booleans, compose them into a unified decision variable, and use clean conditionals with early-return guard clauses:
  ```typescript
  // Stage 1: Atomic Concept Declarations (Types assumed from domain types.d.ts)
  const hasItems = items.length > 0;
  const isFormComplete = isAddressValid && hasAcceptedTerms;
  const hasSufficientFunds = userBalance >= totalCost;

  // Stage 2: Unified Final Decision Variable
  const canCheckout = computed(() => (
    hasItems && isFormComplete && hasSufficientFunds && !isProcessing
  ));

  // Stage 3: Clean Conditionals & Early-Return Guard Clauses
  const handleCheckout = () => {
    if (!canCheckout.value) return;
    processPayment();
  };
  ```
- In React, booleans are pure in-render derivations: never use `useEffect` for computed/derived state.

### B. Named Predicates & Higher-Order Filter Extraction
- Never repeat raw `.filter()` loops with inline multi-clause comparisons across multiple derived collections.
- Extract the atomic predicate callback (`isTierFile(file, tier)`), compose a reusable named filter function (`const filterFiles = (tier) => filteredFiles.value.filter(f => isTierFile(f, tier))`), and declare clean derived computeds:
  ```typescript
  // ❌ Bad: Inlined multi-clause predicates repeated across derivations
  const viewsFiles = computed(() => filteredFiles.value.filter(f => f.path.startsWith("src/") && (f.path.startsWith("src/views") || f.tier === "views")));
  const templatesFiles = computed(() => filteredFiles.value.filter(f => f.path.startsWith("src/") && (f.path.includes("templates/") || f.tier === "templates")));
  const organismsFiles = computed(() => filteredFiles.value.filter(f => f.path.startsWith("src/") && (f.path.includes("organisms/") || f.tier === "organisms")));

  // ✅ Good: Atomic predicate + named higher-order filter + declarative derivations
  const isTierFile = (file: Capsule, tier: string): boolean => {
    const isSrc = file.path.startsWith("src/");
    if (!isSrc) return false;
    return file.path.includes(`${tier}/`) || file.tier === tier;
  };

  const filterFiles = (tier: string) => filteredFiles.value.filter(f => isTierFile(f, tier));

  const viewsFiles = computed(() => filterFiles("views"));
  const templatesFiles = computed(() => filterFiles("templates"));
  const organismsFiles = computed(() => filterFiles("organisms"));
  ```

### C. Single-Action Command Handlers
- Event handlers are linear, unnested orchestrations of pure atomic verbs:
  ```typescript
  const handleAction = async (id: string) => {
    if (!canProceed.value) return;
    triggerHapticFeedback();
    recordTelemetryMetric('action:trigger', { id });
    await executeServiceCall(id);
    dismissActiveModal();
  };
  ```

### D. Ban on Nested Ternaries in Templates
- Never use nested ternaries in templates (`a ? (b ? 'x' : 'y') : 'z'`).
- Extract complex UI display states into dedicated computed descriptor objects returning `{ text: string, color: string }`.

---

## 4. Reactivity, Composables & Hooks

### A. The Molecular Composable Destructuring Contract
1. **Safe Destructuring**: Composables must always return plain objects containing individual `ref()`, `computed()`, and pure functions. Never return a raw `reactive()` object.
2. **The 3 to 5 Property Limit**: Strictly limit return values to State + Status + Actions (maximum 3 to 5 return properties). Multi-responsibility hooks must be split into single-purpose verbs. (Note: For stateful service classes holding shared instance state, refer to the Section 1.J carve-out).
3. **Standardized Aliasing**: Use standardized names (`data`, `isLoading`, `error`, `execute`) to enable clean concurrent destructuring.
4. **Autonomous Lifecycle Teardown**: Side effects (listeners, timers, observers) must be cleaned up automatically using `onScopeDispose()` or effect cleanup functions.
5. **Flexible Input Ergonomics**: Accept raw values, refs, or getters interchangeably via `toValue()` / `MaybeRefOrGetter<T>`.

### B. Clean 3-State Async Pipelines
- Every asynchronous operation follows a predictable state container (`data`, `isLoading`, `error`, `execute`):
  ```typescript
  const { data: items, isLoading, error, execute: loadItems } = useAsyncData(fetchItemsApi);
  const hasItems = computed(() => items.value.length > 0);
  const shouldShowEmptyState = computed(() => !isLoading.value && !hasItems.value && !error.value);
  const shouldShowErrorState = computed(() => !isLoading.value && Boolean(error.value));
  ```

### C. Strict Lexical Declaration Order (TDZ Prevention)
To eliminate Temporal Dead Zone (TDZ) ReferenceErrors, `<script setup>` and controllers strictly follow this lexical declaration order:
1. Composables & Stores (`useRouter()`, `useStore()`)
2. Reactive Primitives (`ref()`, `reactive()`)
3. Computed State (`computed()`)
4. Helper Methods & Actions (`const handleClick = () => { ... }`)
5. Watchers (`watch()`, `watchEffect()`)
6. Lifecycle Hooks (`onMounted()`, `onUnmounted()`)
*Mandatory Rule*: Never reference a reactive value, computed property, or helper in an immediate watcher callback before its declaration.

---

## 5. Design System, Styling & UI Performance

### A. The 4-Tier Zero-Inline-Style Rule
Raw inline `style="..."` attributes are strictly prohibited. Visual styling flows through the standardized 4-tier hierarchy:
1. **Level 1 (Atom Props)**: Semantic props on atoms (`:color="brandColor"`, `variant="glass"`, `size="lg"`).
2. **Level 2 (Mixins & Utilities)**: Centralized SCSS mixins (`@include glass;`, `@include glass-hover;`) and utility classes.
3. **Level 3 (Scoped BEM Classes)**: Scoped classes in component stylesheets referencing design tokens or encapsulating shorthand via `@apply`.
4. **Level 4 (Dynamic Root Variables)**: Dynamic runtime coordinates passed exclusively as root CSS custom properties (`:style="{ '--win-x': \`${x}px\`, '--win-y': \`${y}px\` }"`).

### B. The Anti-Tailwind-Soup Directive (Class Decoupling)
- Prohibit monolithic utility class chains (> 4-5 classes per element) directly inside HTML templates.
- Long strings of utility shorthand recreate the exact cognitive noise and AI context degradation of inline styles.
- Decouple visual styling into scoped classes via `@apply` or centralized SCSS mixins (`@include glass;`).
- Templates must read like a clean, semantic outline rather than an unreadable wall of styling shorthand.

### C. Wrapper Atoms & Explicit Slot Forwarding
- Never use dynamic slot iteration with `v-for="(_, slot) in $slots"` in wrapper components.
- Explicitly forward named slots: `<template #<slot-name>="scope"><slot :name="<slot-name>" v-bind="scope || {}" /></template>`.
- Always wrap default slot in `<template #default="scope"><slot v-bind="scope || {}" /></template>`.

### D. Flat CSS Specificity & Icon Safety
- Single-depth BEM semantic class naming. Never use `!important` overrides.
- **FontAwesome SVG Compliance**: Never attach `text-*` utility classes to FontAwesome icons (breaks SVG rendering). Use native `:color` prop or inline CSS.

### E. 60 FPS Non-Blocking UI Offloading
- Heavy computational operations (parsing, sorting, cryptographic hashing) must be offloaded to Web Workers or chunked micro-batches via `requestIdleCallback`.

---

## 6. Timer & Macro-Task Discipline

### A. Zero `setInterval` in Component & Business Logic
- Polling with `setInterval` is strictly prohibited.
- Use `requestAnimationFrame` for animations and physics.
- Use `videoElement.requestVideoFrameCallback()` for camera/video streams.
- Use a single shared system clock composable (`useSystemClock()`) for time displays.
- Use Server-Sent Events or WebSockets for server state sync.

### B. Zero Render-Hack `setTimeout` (Mandatory `nextTick`)
- Never use `setTimeout(() => { ... }, 0)` to wait for DOM elements to render. Use `await nextTick()` or `watch(..., { flush: 'post' })`.

### C. Self-Cleaning Timer Composables
- Timers for real-world delays must be managed through self-cleaning composables (`useTimeoutFn`, `useDebounceFn`) that cancel automatically on component unmount via `onScopeDispose` or effect teardown.

---

## 7. Infrastructure, Extensibility & Global Hygiene

### A. Zero-Conditional `debug.log` Proxy
- Never use `if (import.meta.env.DEV)` or `if (isProd)` checks around logging statements. Use a central `debug` proxy that automatically silences in production while preserving errors.

### B. Typography Hygiene
- Never use em dashes anywhere in code, copy, markdown, or documentation. Use standard hyphens or colons.

---

## 8. Accessibility & Semantic Integrity

### A. Semantic HTML First
- Never reach for a generic `<div>` or `<span>` with a click handler where a native element (`<button>`, `<a>`, `<label>`, `<nav>`) already carries the correct behavior and semantics for free.
- Interactive elements must be genuinely interactive elements. A clickable `<div>` requires manually re-implementing keyboard focus, Enter/Space activation, and role semantics that native elements provide automatically.

### B. Keyboard & Focus Management
- Every interactive element must be reachable and operable via keyboard alone: Tab to focus, Enter/Space to activate, Esc to dismiss modals and overlays.
- Modals, drawers, and dropdowns must trap focus while open and return focus to the triggering element on close.
- Never remove default focus outlines (`outline: none`) without providing a visible, equivalent custom focus state.

### C. ARIA as a Last Resort, Not a First Layer
- Use ARIA attributes (`aria-label`, `aria-expanded`, `role`) only to fill genuine gaps semantic HTML cannot cover, not as a substitute for correct markup.
- Every image conveying meaning requires alt text; purely decorative images use `alt=""`.
- Form inputs require an associated `<label>`, not a placeholder alone.

### D. Color & Motion Safety
- Text and interactive elements must meet WCAG AA contrast ratios in both light and dark modes; verify new color tokens against both themes, not just one.
- Respect `prefers-reduced-motion` for non-essential animations and transitions.

---

## 9. Security & Content Safety

### A. Zero Unsanitized HTML Injection
- Never render user-supplied or externally-fetched content via `v-html`, `dangerouslySetInnerHTML`, or equivalent raw-HTML injection without passing it through a sanitizer (e.g. DOMPurify) first.
- Treat all externally-fetched content (API responses, user uploads, third-party embeds) as untrusted by default.

### B. Output Encoding & Injection Boundaries
- Never interpolate user input directly into constructed HTML strings, SQL queries, or shell commands. Use parameterized queries and framework-native escaping.
- Never build URLs for redirects or API calls by concatenating unvalidated user input; validate against an allowlist.

### C. Secrets & Credential Hygiene
- Never hardcode API keys, tokens, or credentials in source files, even temporarily during development. Use environment variables or a secrets manager.
- Never log full request/response payloads that may contain auth tokens, passwords, or PII.

### D. CSRF & Auth Boundaries
- State-changing requests (POST/PUT/DELETE) must carry CSRF protection appropriate to the framework's convention, not be assumed safe because they're behind a login.
- Never trust client-side role or permission checks as the sole gate for sensitive actions; the server must re-verify authorization independently.

---

## 10. Testing Discipline

### A. Co-located Test Files
- Test files live alongside the capsule they cover (`m-<feature>-card.spec.ts` inside the capsule directory), not in a separate parallel test tree that drifts from the source structure.

### B. What Must Be Covered
- Every exported pure function, composable, and domain type guard requires at least one test exercising its primary path and one exercising a failure/edge path.
- UI components require at least a render smoke test; interactive components require a test covering their primary user action.

### C. Refactor Discipline
- When decomposing a file per Section 1, existing tests move and are updated to match the new file boundaries in the same pass; a refactor is not complete until its tests pass against the new structure.
- Never delete or skip a failing test to unblock a commit; fix the code or the test, or flag the failure explicitly.

### D. No Fake Green
- Never write a test that trivially passes without exercising real logic (e.g. asserting `true === true`, mocking away the exact behavior under test).

---

## 11. Naming Conventions

### A. Casing
- Files: kebab-case (`m-user-card.controller.ts`).
- Variables, functions, composables: camelCase (`isLoading`, `useAsyncData`).
- Types, interfaces, components: PascalCase (`SessionState`, `UserCard`).
- Constants meant to be immutable module-level config: SCREAMING_SNAKE_CASE (`MAX_RETRY_COUNT`).

### B. Boolean & Predicate Prefixes
- Booleans use `is`, `has`, `can`, or `should` prefixes (`isLoading`, `hasItems`, `canCheckout`, `shouldShowEmptyState`), matching the pattern already used in Section 3.A and 4.B examples. Never name a boolean as a bare noun or adjective (`loading`, `valid`) that hides its type at the call site.

### C. Event & Handler Naming
- Emitted events describe what happened, not what to do (`item-selected`, not `select-item`).
- Handler functions describe the action taken, prefixed `handle` (`handleCheckout`), matching Section 3.C.

---

## 12. Documentation Discipline

### A. Derived Contract Synchronization
- Derived contract fields (signatures, parameters, payload structures, return types) in capsule documentation must be extracted directly from `types.d.ts`, never manually duplicated or hand-typed.
- Any change to `types.d.ts` must automatically propagate to or be validated against the capsule reference documentation.

### B. Mandatory Doc-Touch CI Gate
- A commit that modifies a capsule's implementation or controller without updating the corresponding documentation prose section must fail CI validation.
- Refactors and behavioral changes are not complete until documentation accurately reflects updated semantics, mirroring Section 10.C.

### C. "No Fake Doc-Sync" Anti-Pattern
- Mirroring the "No Fake Green" testing rule in Section 10.D, superficial doc edits (whitespace tweaks, comment formatting, minor typo fixes) made merely to pass CI touch-checks without addressing substantive semantic changes are strictly prohibited.
- Documentation reviews must verify substantive alignment between code behavior and documented contracts.
