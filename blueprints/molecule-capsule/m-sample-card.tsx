import React from 'react';
import type { MSampleCardProps } from './types';

export const MSampleCard: React.FC<MSampleCardProps> = ({
  title,
  subtitle,
  value,
  status = 'active',
  onAction
}) => {
  const isHighValue = value > 1000;
  const badgeColor = status === 'active' ? (isHighValue ? '#4ade80' : '#86efac') : '#f87171';

  return (
    <div style={{ background: '#131e3a', border: '1px solid #1e293b', borderRadius: '8px', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#fff' }}>{title}</h3>
          {subtitle && <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>{subtitle}</p>}
        </div>
        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#0b1329', color: badgeColor }}>
          {status}
        </span>
      </div>
      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#62c9ff' }}>
          \${value.toLocaleString()}
        </div>
        {onAction && (
          <button
            onClick={onAction}
            style={{ padding: '6px 12px', background: '#1e293b', border: '1px solid #334155', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}
          >
            Action
          </button>
        )}
      </div>
    </div>
  );
};
export default MSampleCard;
