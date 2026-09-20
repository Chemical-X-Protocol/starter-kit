import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import StandardsHeader from './StandardsHeader.vue';

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

const GradientChemicalXStub = {
  name: 'GradientChemicalX',
  template: '<span class="chemx-stub">Chemical X</span>'
};

const UIconStub = {
  name: 'UIcon',
  props: ['name'],
  template: '<span class="icon-stub" :data-icon="name" />'
};

describe('StandardsHeader', () => {
  const defaultMountOptions = {
    global: {
      stubs: {
        AtomSurface: AtomSurfaceStub,
        QuantumBadge: QuantumBadgeStub,
        GradientChemicalX: GradientChemicalXStub,
        UIcon: UIconStub
      }
    }
  };

  it('mounts cleanly and renders heading and audit copy button', () => {
    const wrapper = mount(StandardsHeader, defaultMountOptions);
    expect(wrapper.text()).toContain('Engineering Standards for');
    expect(wrapper.text()).toContain('npx chemx audit');
    expect(wrapper.text()).toContain('Free Local AST Audit');
  });
});
