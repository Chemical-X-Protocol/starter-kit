import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import FunnelSystemLayerDetailCard from './FunnelSystemLayerDetailCard.vue';
import { SYSTEM_LAYERS } from './funnel-system-layers.data';

const QuantumBadgeStub = {
  name: 'QuantumBadge',
  props: ['text', 'tone', 'size'],
  template: '<span class="badge-stub">{{ text }}</span>'
};

const UIconStub = {
  name: 'UIcon',
  props: ['name'],
  template: '<span class="icon-stub" :data-icon="name" />'
};

describe('FunnelSystemLayerDetailCard', () => {
  const defaultMountOptions = {
    props: {
      layer: SYSTEM_LAYERS[0]
    },
    global: {
      stubs: {
        QuantumBadge: QuantumBadgeStub,
        UIcon: UIconStub
      }
    }
  };

  it('mounts cleanly and displays layer name, role, and number', () => {
    const wrapper = mount(FunnelSystemLayerDetailCard, defaultMountOptions);
    expect(wrapper.text()).toContain('Layer 1 of 7');
    expect(wrapper.text()).toContain('Architecture Layer');
    expect(wrapper.text()).toContain('The 7 Molecular Pillars');
  });

  it('renders thesis and impact on AI agents', () => {
    const wrapper = mount(FunnelSystemLayerDetailCard, defaultMountOptions);
    expect(wrapper.text()).toContain('Core Thesis');
    expect(wrapper.text()).toContain('Impact on AI Agents');
    expect(wrapper.text()).toContain(SYSTEM_LAYERS[0].thesis);
  });

  it('renders all key mechanisms', () => {
    const wrapper = mount(FunnelSystemLayerDetailCard, defaultMountOptions);
    SYSTEM_LAYERS[0].keyMechanisms.forEach((mech) => {
      expect(wrapper.text()).toContain(mech);
    });
  });
});
