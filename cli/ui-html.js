/**
 * Chemical X UI HTML Generator
 * Assembles the Swarm Control page: cli/ui-index.html, the component files under cli/ui-page/components
 * (each .css and .js inlined in name order, so every feature owns its own file), and the hydrated state.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPONENTS_DIR = path.resolve(__dirname, 'ui-page', 'components');

const readComponents = (dir = COMPONENTS_DIR) => {
  const hasDir = fs.existsSync(dir);
  if (!hasDir) return '';
  const names = fs.readdirSync(dir).filter((n) => /\.(css|js)$/.test(n)).sort();
  const asTag = (name) => {
    const text = fs.readFileSync(path.join(dir, name), 'utf8').replace(/<\/(script|style)/gi, '<\\/$1');
    return name.endsWith('.css') ? `<style data-file="${name}">\n${text}\n</style>` : `<script data-file="${name}">\n${text}\n</script>`;
  };
  return names.map(asTag).join('\n');
};

export const generateSwarmHtml = (initialState = {}, { componentsDir = COMPONENTS_DIR } = {}) => {
  const jsonState = JSON.stringify(initialState).replace(/</g, '\\u003c');
  // cli/ui-index.html is the page chemx ui serves; a project may supply its own src/ui/index.html.
  const candidates = [
    path.resolve(__dirname, 'ui-index.html'),
    path.resolve(process.cwd(), 'src/ui/index.html')
  ];

  const source = candidates.find((candidate) => fs.existsSync(candidate));
  const raw = source ? fs.readFileSync(source, 'utf8') : '';

  const injection = `<script>window.__CHEMX_HYDRATED_STATE__ = ${jsonState};</script>\n${readComponents(componentsDir)}`;
  const hasHead = raw.includes('</head>');
  if (!hasHead) return raw + injection;
  // A replacer function: a string replacement would expand $', $& and $` found in task text.
  return raw.replace('</head>', () => `  ${injection}\n</head>`);
};
