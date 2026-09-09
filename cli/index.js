#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const capsuleName = process.argv[2];

if (!capsuleName) {
  process.stderr.write('Usage: npx chemical-x <capsule-name>\n');
  process.stderr.write('Example: npx chemical-x m-user-avatar\n');
  process.exit(1);
}

const normalizedName = capsuleName.startsWith('m-') ? capsuleName : `m-${capsuleName}`;
const targetDir = path.resolve(process.cwd(), normalizedName);

if (fs.existsSync(targetDir)) {
  process.stderr.write(`Error: Directory ${normalizedName} already exists.\n`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

const pascalName = normalizedName
  .split('-')
  .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
  .join('');

const componentCode = `import React from 'react';
import type { ${pascalName}Props } from './types';

export const ${pascalName}: React.FC<${pascalName}Props> = ({ label }) => {
  return (
    <div className="${normalizedName}">
      <span>{label}</span>
    </div>
  );
};

export default ${pascalName};
`;

const typesCode = `export interface ${pascalName}Props {
  readonly label: string;
}
`;

const indexCode = `export { ${pascalName} } from './${normalizedName}';
export type { ${pascalName}Props } from './types';
`;

fs.writeFileSync(path.join(targetDir, `${normalizedName}.tsx`), componentCode, 'utf-8');
fs.writeFileSync(path.join(targetDir, 'types.d.ts'), typesCode, 'utf-8');
fs.writeFileSync(path.join(targetDir, 'index.ts'), indexCode, 'utf-8');

process.stdout.write(`Successfully created Chemical X molecule capsule: ${normalizedName}/\n`);
