import React from 'react';

export interface ViewTemplateProps {
  readonly title: string;
  readonly children: React.ReactNode;
}

export const ViewTemplate: React.FC<ViewTemplateProps> = ({ title, children }) => {
  return (
    <main style={{ padding: '24px', background: '#0b1329', color: '#e2e8f0', minHeight: '100vh' }}>
      <header style={{ marginBottom: '24px', borderBottom: '1px solid #1e293b', paddingBottom: '16px' }}>
        <h1 style={{ margin: 0, fontSize: '24px', color: '#62c9ff' }}>{title}</h1>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {children}
      </div>
    </main>
  );
};
export default ViewTemplate;
