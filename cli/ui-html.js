/**
 * Chemical X UI HTML Generator
 * Assembles Chemical X Swarm Control modern Vuetify 3 webapp with hydrated state
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const generateSwarmHtml = (initialState = {}) => {
  const jsonState = JSON.stringify(initialState).replace(/</g, '\\u003c');
  const candidates = [
    path.resolve(__dirname, '../src/ui/index.html'),
    path.resolve(__dirname, 'ui-index.html'),
    path.resolve(process.cwd(), 'src/ui/index.html')
  ];

  let raw = '';
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      raw = fs.readFileSync(p, 'utf8');
      break;
    }
  }

  const injection = `<script>window.__CHEMX_HYDRATED_STATE__ = ${jsonState};</script>`;
  if (raw.includes('</head>')) {
    return raw.replace('</head>', `  ${injection}\n</head>`);
  }
  return raw + injection;
};

