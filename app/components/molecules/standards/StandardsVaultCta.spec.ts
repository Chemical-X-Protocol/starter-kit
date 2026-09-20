import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import StandardsVaultCta from './StandardsVaultCta.vue';

const AtomSurfaceStub = {
  name: 'AtomSurface',
  props: ['customClass'],
  template: '<div :class="customClass"><slot /></div>'
};

const AtomButtonStub = {
  name: 'AtomButton',
  props: ['customClass', 'type', 'ariaLabel'],
  emits: ['click'],
  template: '<div class="atom-btn-stub" @click="$emit(\'click\', $event)"><slot /></div>'
};

const QuantumBadgeStub = {
  name: 'QuantumBadge',
  props: ['text', 'tone'],
  template: '<span class="badge-stub">{{ text }}</span>'
};

const UIconStub = {
  name: 'UIcon',
  props: ['name'],
  template: '<span class="icon-stub" :data-icon="name" />'
};

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: ['to'],
  template: '<a :href="to"><slot /></a>'
};

describe('StandardsVaultCta', () => {
  const defaultMountOptions = {
    global: {
      stubs: {
        AtomSurface: AtomSurfaceStub,
        AtomButton: AtomButtonStub,
        QuantumBadge: QuantumBadgeStub,
        UIcon: UIconStub,
        NuxtLink: NuxtLinkStub
      }
    }
  };

  it('mounts cleanly and emits unlockRequest when license button is clicked', async () => {
    const wrapper = mount(StandardsVaultCta, defaultMountOptions);
    expect(wrapper.text()).toContain('Unlock the Complete Vault');

    const btn = wrapper.findComponent(AtomButtonStub);
    await btn.trigger('click');

    expect(wrapper.emitted('unlockRequest')).toBeTruthy();
  });
});
