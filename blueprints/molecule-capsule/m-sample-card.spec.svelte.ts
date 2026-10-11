import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import MSampleCard from './m-sample-card.svelte';

describe('m-sample-card: MSampleCard Component', () => {
  it('renders title, formatted value, and standard badge correctly', () => {
    const { body } = render(MSampleCard, {
      props: { title: 'Core Subscription', subtitle: 'Monthly compute tier', value: 750 }
    });

    expect(body).toContain('class="m-sample-card"');
    expect(body).toContain('Core Subscription');
    expect(body).toContain('Monthly compute tier');
    expect(body).toContain('$750');
    expect(body).toContain('m-sample-card__badge--standard');
    expect(body).not.toContain('m-sample-card__action');
  });

  it('renders high-value modifier when numeric value exceeds 1000', () => {
    const { body } = render(MSampleCard, { props: { title: 'Enterprise Cluster', value: 2500 } });

    expect(body).toContain('Enterprise Cluster');
    expect(body).toContain('$2,500');
    expect(body).toContain('m-sample-card__badge--high-value');
  });

  it('renders the action button only when onAction is given', () => {
    const { body } = render(MSampleCard, { props: { title: 'Actionable Unit', value: 1200, onAction: () => undefined } });

    expect(body).toContain('m-sample-card__action');
    expect(body).toContain('Action');
  });
});
