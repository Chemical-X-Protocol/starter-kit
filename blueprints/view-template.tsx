import React from 'react';

export interface ViewTemplateProps {
  readonly title: string;
  readonly children: React.ReactNode;
}

export const ViewTemplate: React.FC<ViewTemplateProps> = ({ title, children }) => {
  return (
    <main className="view-template">
      <header className="view-template__header">
        <h1 className="view-template__title">{title}</h1>
      </header>
      <div className="view-template__content">
        {children}
      </div>
    </main>
  );
};
export default ViewTemplate;
