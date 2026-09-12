import React from 'react';
import type { MSampleCardProps, SampleCardBadgeDescriptor } from './types';

export const resolveBadgeDescriptor = (
  status: 'active' | 'archived',
  isHighValue: boolean
): SampleCardBadgeDescriptor => {
  if (status !== 'active') {
    return {
      text: status,
      className: 'm-sample-card__badge m-sample-card__badge--archived'
    };
  }

  if (isHighValue) {
    return {
      text: status,
      className: 'm-sample-card__badge m-sample-card__badge--high-value'
    };
  }

  return {
    text: status,
    className: 'm-sample-card__badge m-sample-card__badge--standard'
  };
};

export const MSampleCard: React.FC<MSampleCardProps> = ({
  title,
  subtitle,
  value,
  status = 'active',
  onAction
}) => {
  const isHighValue = value > 1000;
  const badge = resolveBadgeDescriptor(status, isHighValue);

  const handleActionClick = () => {
    if (!onAction) return;
    onAction();
  };

  return (
    <div className="m-sample-card">
      <div className="m-sample-card__header">
        <div className="m-sample-card__title-group">
          <h3 className="m-sample-card__title">{title}</h3>
          {subtitle && <p className="m-sample-card__subtitle">{subtitle}</p>}
        </div>
        <span className={badge.className}>
          {badge.text}
        </span>
      </div>
      <div className="m-sample-card__body">
        <div className="m-sample-card__value">
          ${value.toLocaleString()}
        </div>
        {onAction && (
          <button
            type="button"
            className="m-sample-card__action"
            onClick={handleActionClick}
          >
            Action
          </button>
        )}
      </div>
    </div>
  );
};

export default MSampleCard;
