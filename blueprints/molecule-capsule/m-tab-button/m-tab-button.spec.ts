import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MTabButton from './m-tab-button.vue';

describe('m-tab-button capsule', () => {
  it('renders label and inactive modifier', () => {
    const wrapper = mount(MTabButton, {
      props: {
        label: 'Rule Book',
        isActive: false
      }
    });

    expect(wrapper.text()).toContain('Rule Book');
    expect(wrapper.classes()).toContain('m-tab-button--inactive');
  });

  it('applies active tone modifier when active', () => {
    const wrapper = mount(MTabButton, {
      props: {
        label: 'Problem Solves',
        isActive: true,
        activeTone: 'pink'
      }
    });

    expect(wrapper.classes()).toContain('m-tab-button--pink');
  });

  it('emits select on click', async () => {
    const wrapper = mount(MTabButton, {
      props: {
        label: 'Teaser'
      }
    });

    await wrapper.trigger('click');
    expect(wrapper.emitted('select')).toBeTruthy();
  });
});
