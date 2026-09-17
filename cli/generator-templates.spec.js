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
  buildViewSpec
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
