import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import FunnelSystemAdoptionStrip from './FunnelSystemAdoptionStrip.vue';

const AtomSurfaceStub = {
  name: 'AtomSurface',
  props: ['customClass'],
  template: '<div :class="customClass"><slot /></div>'
};

describe('FunnelSystemAdoptionStrip', () => {
  it('mounts cleanly and renders all 3 adoption steps', () => {
    const wrapper = mount(FunnelSystemAdoptionStrip, {
      global: {
        stubs: {
          AtomSurface: AtomSurfaceStub
        }
      }
    });

    expect(wrapper.text()).toContain('How to Adopt Chemical X: The 3-Step Loop');
    expect(wrapper.text()).toContain('1. Free AST Audit');
    expect(wrapper.text()).toContain('2. Wire Your Agent Loop');
    expect(wrapper.text()).toContain('3. Accelerate with Vault');
  });
});
