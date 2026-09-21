import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toPascalCase,
  toCamelCase,
  buildReactComponent,
  buildVueComponent,
  buildSvelteComponent,
  buildController,
  buildPropsType,
  buildStateType,
  buildTypesIndex,
  buildTypes,
  buildComponentSpec,
  buildIndex,
  buildScss,
  buildHook,
  buildHookOptionsType,
  buildHookReturnType,
  buildHookIndex,
  buildHookSpec,
  buildReactView,
  buildVueView,
  buildSvelteView,
  buildViewParamsType,
  buildViewIndex,
  buildViewSpec,
  resolveArchetype,
  ALL_ARCHETYPES
} from './generator-templates.js';

test('naming: toPascalCase and toCamelCase handle prefixes and hyphens', () => {
  assert.equal(toPascalCase('m-user-avatar'), 'UserAvatar');
  assert.equal(toPascalCase('use-spark-feed'), 'SparkFeed');
  assert.equal(toPascalCase('v-dashboard-overview'), 'DashboardOverview');
  assert.equal(toCamelCase('use-spark-feed'), 'useSparkFeed');
  assert.equal(toCamelCase('m-spark-kpi'), 'sparkKpi');
});

test('components: buildReactComponent handles options', () => {
  const standard = buildReactComponent('m-card', 'Card');
  assert.ok(standard.includes('export const Card: React.FC<CardProps>'));
  assert.ok(standard.includes('useCardController'));

  const withAtoms = buildReactComponent('m-card', 'Card', { atomsPackage: '@chemx/x-atoms' });
  assert.ok(withAtoms.includes("import { AtomButton } from '@chemx/x-atoms';"));

  const lean = buildReactComponent('a-pill', 'Pill', { hasController: false });
  assert.ok(!lean.includes('usePillController'));
  assert.ok(lean.includes('const canProceed = true;'));
});

test('components: buildVueComponent and buildSvelteComponent handle options', () => {
  const vue = buildVueComponent('m-card', 'Card', { atomsPackage: '@chemx/x-atoms' });
  assert.ok(vue.includes('<a-button'));

  const svelte = buildSvelteComponent('m-card', 'Card', { atomsPackage: '@chemx/x-atoms' });
  assert.ok(svelte.includes('<AtomButton'));
});

test('controller: buildController generates valid react hook code', () => {
  const code = buildController('m-card', 'Card');
  assert.ok(code.includes('export const useCardController ='));
  assert.ok(code.includes('useState<CardState>'));
});

test('types: buildPropsType, buildStateType, and buildTypes produce contract definitions', () => {
  const types = buildTypes('m-card', 'Card');
  assert.ok(types.includes('CardState'));
  assert.ok(types.includes('CardProps'));
  assert.ok(buildTypesIndex().includes("export type * from './props.d.ts';"));
});

test('specs and styles: buildComponentSpec, buildIndex, and buildScss generate expected assets', () => {
  const specWithCtrl = buildComponentSpec('m-card', 'Card', true);
  assert.ok(specWithCtrl.includes('useCardController'));
  const specLean = buildComponentSpec('a-pill', 'Pill', false);
  assert.ok(specLean.includes('Pill Atom Foundation'));

  const idxVue = buildIndex('m-card', 'Card', 'vue');
  assert.ok(idxVue.includes("export { default as Card } from './m-card.vue';"));

  const scss = buildScss('m-card');
  assert.ok(scss.includes('.m-card {'));
});

test('hooks: buildHook and related generators produce full composable suite', () => {
  const hook = buildHook('use-feed', 'useFeed', 'Feed');
  assert.ok(hook.includes('export const useFeed ='));
  assert.ok(buildHookOptionsType('Feed').includes('FeedHookOptions'));
  assert.ok(buildHookReturnType('Feed').includes('FeedHookReturn'));
  assert.ok(buildHookIndex('use-feed', 'useFeed').includes("export { useFeed } from './use-feed';"));
  assert.ok(buildHookSpec('use-feed', 'useFeed').includes("describe('useFeed Hook Composable'"));
});

test('views: buildReactView, buildVueView, buildSvelteView, and view helpers generate TOC templates', () => {
  const reactView = buildReactView('v-home', 'Home');
  assert.ok(reactView.includes('export const HomeView: React.FC<HomeViewParams>'));
  assert.ok(reactView.includes('<main className="v-home">'));

  const vueView = buildVueView('v-home', 'Home');
  assert.ok(vueView.includes('<main class="v-home">'));

  const svelteView = buildSvelteView('v-home', 'Home');
  assert.ok(svelteView.includes('<main class="v-home">'));

  assert.ok(buildViewParamsType('Home').includes('HomeViewParams'));
  assert.ok(buildViewIndex('v-home', 'Home', 'tsx').includes("export { HomeView } from './v-home';"));
  assert.ok(buildViewSpec('v-home', 'Home').includes("describe('HomeView Table of Contents'"));
});

test('archetypes: ALL_ARCHETYPES contains exactly 22 canonical UI archetypes', () => {
  assert.equal(ALL_ARCHETYPES.length, 22);

  const ids = new Set(ALL_ARCHETYPES.map((a) => a.id));
  assert.equal(ids.size, 22);

  for (const arch of ALL_ARCHETYPES) {
    assert.ok(arch.id, 'Archetype must have an id');
    assert.ok(arch.name, `Archetype ${arch.id} must have a name`);
    assert.ok(Array.isArray(arch.keywords) && arch.keywords.length > 0, `Archetype ${arch.id} must have keywords`);
    assert.ok(typeof arch.destructure === 'string' && arch.destructure.length > 0, `Archetype ${arch.id} must have destructure`);
    assert.ok(typeof arch.buildState === 'function', `Archetype ${arch.id} must have buildState`);
    assert.ok(typeof arch.buildProps === 'function', `Archetype ${arch.id} must have buildProps`);
    assert.ok(typeof arch.buildController === 'function', `Archetype ${arch.id} must have buildController`);
    assert.ok(typeof arch.buildReactBody === 'function', `Archetype ${arch.id} must have buildReactBody`);
  }
});

test('archetypes: resolveArchetype matches IDs, prefixes, and keywords with fallback', () => {
  assert.equal(resolveArchetype('task-list').id, 'task-list');
  assert.equal(resolveArchetype('m-task-list').id, 'task-list');
  assert.equal(resolveArchetype('m-todos').id, 'task-list');

  assert.equal(resolveArchetype('m-data-table').id, 'data-table');
  assert.equal(resolveArchetype('m-user-avatar').id, 'user-profile');
  assert.equal(resolveArchetype('m-search-bar').id, 'search-filter');
  assert.equal(resolveArchetype('m-modal-dialog').id, 'modal-dialog');
  assert.equal(resolveArchetype('m-chat-inbox').id, 'chat-messaging');
  assert.equal(resolveArchetype('m-pricing-cart').id, 'cart-billing');
  assert.equal(resolveArchetype('m-timer-countdown').id, 'timer-countdown');

  // Fallback to state-boundary
  assert.equal(resolveArchetype('m-unknown-xyz').id, 'state-boundary');
  assert.equal(resolveArchetype('m-card').id, 'state-boundary');
});

test('archetypes: semantic code generation for task-list archetype', () => {
  const controller = buildController('m-task-list', 'TaskList');
  assert.ok(controller.includes('useTaskListController'));
  assert.ok(controller.includes('toggleItem'));
  assert.ok(controller.includes('removeItem'));

  const props = buildPropsType('m-task-list', 'TaskList');
  assert.ok(props.includes('TaskListProps'));
  assert.ok(props.includes('initialItems?: readonly TaskListItem[]'));

  const state = buildStateType('m-task-list', 'TaskList');
  assert.ok(state.includes('TaskListItem'));
  assert.ok(state.includes('TaskListState'));

  const react = buildReactComponent('m-task-list', 'TaskList');
  assert.ok(react.includes('useTaskListController'));
  assert.ok(react.includes('items, filter, activeCount, setFilter, toggleItem, removeItem'));
  assert.ok(react.includes('m-task-list__list'));

  const withAtoms = buildReactComponent('m-task-list', 'TaskList', { atomsPackage: '@chemx/x-atoms' });
  assert.ok(withAtoms.includes("import { AtomButton } from '@chemx/x-atoms';"));
  assert.ok(withAtoms.includes('<AtomButton'));
  assert.ok(!withAtoms.includes('<button'));
});

test('archetypes: resolveArchetype matches from description keywords', () => {
  const matched = resolveArchetype('m-backlog', 'add, toggle, remove task items');
  assert.equal(matched.id, 'task-list');

  const chat = resolveArchetype('m-widget', 'chat messages, send message, thread');
  assert.equal(chat.id, 'chat-messaging');

  const cart = resolveArchetype('m-box', 'shopping cart checkout billing payment');
  assert.equal(cart.id, 'cart-billing');
});

test('archetypes: resolveArchetype matches from semantic vector embeddings on unknown slugs', () => {
  const chat = resolveArchetype('m-quantum-nexus', 'live chat messages conversation thread');
  assert.equal(chat.id, 'chat-messaging');
});
