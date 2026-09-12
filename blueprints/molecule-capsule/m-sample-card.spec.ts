import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MSampleCard, resolveBadgeDescriptor } from './m-sample-card';

describe('m-sample-card: resolveBadgeDescriptor', () => {
  it('returns archived badge descriptor when status is archived', () => {
    const descriptor = resolveBadgeDescriptor('archived', false);
    expect(descriptor.text).toBe('archived');
    expect(descriptor.className).toBe('m-sample-card__badge m-sample-card__badge--archived');
  });

  it('returns high-value badge descriptor when active and value exceeds threshold', () => {
    const descriptor = resolveBadgeDescriptor('active', true);
    expect(descriptor.text).toBe('active');
    expect(descriptor.className).toBe('m-sample-card__badge m-sample-card__badge--high-value');
  });

  it('returns standard badge descriptor when active and value is within standard range', () => {
    const descriptor = resolveBadgeDescriptor('active', false);
    expect(descriptor.text).toBe('active');
    expect(descriptor.className).toBe('m-sample-card__badge m-sample-card__badge--standard');
  });
});

describe('m-sample-card: MSampleCard Component', () => {
  it('renders title, formatted value, and standard badge correctly', () => {
    const html = renderToStaticMarkup(
      React.createElement(MSampleCard, {
        title: 'Core Subscription',
        subtitle: 'Monthly compute tier',
        value: 750
      })
    );

    expect(html).toContain('class="m-sample-card"');
    expect(html).toContain('Core Subscription');
    expect(html).toContain('Monthly compute tier');
    expect(html).toContain('$750');
    expect(html).toContain('m-sample-card__badge--standard');
    expect(html).not.toContain('m-sample-card__action');
  });

  it('renders high-value modifier when numeric value exceeds 1000', () => {
    const html = renderToStaticMarkup(
      React.createElement(MSampleCard, {
        title: 'Enterprise Cluster',
        value: 2500
      })
    );

    expect(html).toContain('Enterprise Cluster');
    expect(html).toContain('$2,500');
    expect(html).toContain('m-sample-card__badge--high-value');
  });

  it('renders action button and triggers onAction callback when clicked', () => {
    const handleAction = vi.fn();
    const vnode = MSampleCard({
      title: 'Actionable Unit',
      value: 1200,
      onAction: handleAction
    }) as React.ReactElement;

    const bodyNode = (vnode.props.children as React.ReactElement[])[1];
    const buttonNode = (bodyNode.props.children as React.ReactElement[])[1];

    expect(buttonNode).toBeDefined();
    expect(buttonNode.props.className).toBe('m-sample-card__action');

    buttonNode.props.onClick();
    expect(handleAction).toHaveBeenCalledTimes(1);
  });
});
