import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PublicStandardsView from './PublicStandardsView.vue';
import { QUANTUM_CHAPTERS } from '~/lib/data/chapters';

const AtomSurfaceStub = {
  name: 'AtomSurface',
  props: ['customClass'],
  template: '<div :class="customClass"><slot /></div>'
};

const QuantumBadgeStub = {
  name: 'QuantumBadge',
  props: ['text', 'tone'],
  template: '<span class="badge-stub">{{ text }}</span>'
};

const StandardsHeaderStub = {
  name: 'StandardsHeader',
  template: '<div class="standards-header-stub">StandardsHeader</div>'
};

const StandardsVaultCtaStub = {
  name: 'StandardsVaultCta',
  emits: ['unlockRequest'],
  template: '<div class="vault-cta-stub" @click="$emit(\'unlockRequest\')">VaultCta</div>'
};

const AuditPillarsShowcaseStub = {
  name: 'AuditPillarsShowcase',
  template: '<div class="pillars-showcase-stub" />'
};

const ChapterAccordionStub = {
  name: 'ChapterAccordion',
  props: ['chapter', 'isInitiallyOpen', 'isUnlocked'],
  emits: ['unlockRequest'],
  template: '<div class="chapter-accordion-stub">{{ chapter.title }}</div>'
};

describe('PublicStandardsView', () => {
  const defaultMountOptions = {
    global: {
      stubs: {
        AtomSurface: AtomSurfaceStub,
        QuantumBadge: QuantumBadgeStub,
        StandardsHeader: StandardsHeaderStub,
        StandardsVaultCta: StandardsVaultCtaStub,
        AuditPillarsShowcase: AuditPillarsShowcaseStub,
        ChapterAccordion: ChapterAccordionStub
      }
    }
  };

  it('mounts cleanly and renders all 7 chapter accordions', () => {
    const wrapper = mount(PublicStandardsView, defaultMountOptions);
    const accordions = wrapper.findAllComponents(ChapterAccordionStub);

    expect(accordions.length).toBe(QUANTUM_CHAPTERS.length);
    expect(wrapper.text()).toContain('Explore the 7 Chapter Specifications');
  });

  it('forwards unlockRequest from child components', async () => {
    const wrapper = mount(PublicStandardsView, defaultMountOptions);
    const cta = wrapper.findComponent(StandardsVaultCtaStub);

    await cta.trigger('click');
    expect(wrapper.emitted('unlockRequest')).toBeTruthy();
  });
});
