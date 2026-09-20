import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import FunnelSystemLayersSection from './FunnelSystemLayersSection.vue';
import { SYSTEM_LAYERS } from './funnel-system-layers.data';

const AtomSurfaceStub = {
  name: 'AtomSurface',
  props: ['customClass', 'id', 'as'],
  template: '<div :class="customClass" :id="id"><slot /></div>'
};

const AtomButtonStub = {
  name: 'AtomButton',
  props: ['customClass', 'type', 'ariaLabel'],
  emits: ['click'],
  template: '<div class="atom-button-stub" :class="customClass" :aria-label="ariaLabel" @click="$emit(\'click\', $event)"><slot /></div>'
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

const FunnelSystemLayerDetailCardStub = {
  name: 'FunnelSystemLayerDetailCard',
  props: ['layer'],
  template: '<div class="detail-card-stub" :data-layer-id="layer.id">{{ layer.name }}</div>'
};

const FunnelSystemAdoptionStripStub = {
  name: 'FunnelSystemAdoptionStrip',
  template: '<div class="adoption-strip-stub" />'
};

describe('FunnelSystemLayersSection', () => {
  const defaultMountOptions = {
    global: {
      stubs: {
        AtomSurface: AtomSurfaceStub,
        AtomButton: AtomButtonStub,
        QuantumBadge: QuantumBadgeStub,
        GradientChemicalX: GradientChemicalXStub,
        UIcon: UIconStub,
        FunnelSystemLayerDetailCard: FunnelSystemLayerDetailCardStub,
        FunnelSystemAdoptionStrip: FunnelSystemAdoptionStripStub
      }
    }
  };

  it('mounts cleanly and renders all 7 layer buttons', () => {
    const wrapper = mount(FunnelSystemLayersSection, defaultMountOptions);
    const buttons = wrapper.findAllComponents(AtomButtonStub);

    expect(buttons.length).toBe(7);
    expect(wrapper.text()).toContain('The 7 Layers of');
  });

  it('initially displays Architecture Layer details', () => {
    const wrapper = mount(FunnelSystemLayersSection, defaultMountOptions);
    const detailCard = wrapper.findComponent(FunnelSystemLayerDetailCardStub);

    expect(detailCard.exists()).toBe(true);
    expect(detailCard.props('layer').id).toBe('architecture');
  });

  it('switches active layer when another layer button is clicked', async () => {
    const wrapper = mount(FunnelSystemLayersSection, defaultMountOptions);
    const buttons = wrapper.findAllComponents(AtomButtonStub);

    await buttons[2].trigger('click');

    const detailCard = wrapper.findComponent(FunnelSystemLayerDetailCardStub);
    expect(detailCard.props('layer').id).toBe(SYSTEM_LAYERS[2].id);
  });
});
