import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const UI_DIR = path.resolve(process.cwd(), 'src/ui');

function getAllFiles(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

test('ADVERSARIAL 1: Every single file in src/ui is strictly < 100 lines', () => {
  const files = getAllFiles(UI_DIR);
  assert.ok(files.length >= 20, `Expected at least 20 UI files, found ${files.length}`);

  const exceeded = [];
  let maxLines = 0;
  let maxFile = '';

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n').length;
    const rel = path.relative(process.cwd(), file);
    if (lines > maxLines) {
      maxLines = lines;
      maxFile = rel;
    }
    if (lines >= 100) {
      exceeded.push({ file: rel, lines });
    }
  }

  assert.strictEqual(
    exceeded.length,
    0,
    `Files exceeding 100 lines limit: ${JSON.stringify(exceeded)}`
  );
  assert.ok(maxLines < 100, `Max lines was ${maxLines} in ${maxFile}`);
});

test('ADVERSARIAL 2: ZERO raw DOM elements in molecules and organisms (comprehensive tag dictionary)', () => {
  const files = getAllFiles(UI_DIR).filter((f) => {
    return (f.includes('/molecules/') || f.includes('/organisms/')) && f.endsWith('.vue');
  });

  assert.ok(files.length >= 7, `Expected at least 7 molecule/organism Vue files, found ${files.length}`);

  // Comprehensive adversarial raw DOM element list
  const rawTags = [
    'div', 'span', 'button', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'input', 'textarea', 'select', 'a', 'ul', 'ol', 'li', 'table', 'tr',
    'td', 'th', 'tbody', 'thead', 'tfoot', 'form', 'label', 'img', 'svg',
    'canvas', 'audio', 'video', 'header', 'footer', 'main', 'aside',
    'section', 'nav', 'article', 'b', 'strong', 'i', 'em', 'small', 'mark'
  ];

  const tagPattern = new RegExp(`<(${rawTags.join('|')})\\b`, 'i');
  const violations = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const templateMatch = content.match(/<template>([\s\S]*?)<\/template>/);
    const rel = path.relative(process.cwd(), file);
    assert.ok(templateMatch, `File ${rel} is missing <template> block`);

    const template = templateMatch[1];
    const match = template.match(tagPattern);
    if (match) {
      violations.push({ file: rel, tag: match[1] });
    }
  }

  assert.strictEqual(
    violations.length,
    0,
    `Forbidden raw DOM elements found in molecules/organisms: ${JSON.stringify(violations)}`
  );
});

test('ADVERSARIAL 3: v-swarm-social.vue is strictly 10 to 20 lines and purely declarative TOC', () => {
  const viewPath = path.join(UI_DIR, 'views/v-swarm-social.vue');
  assert.ok(fs.existsSync(viewPath), 'v-swarm-social.vue must exist');

  const content = fs.readFileSync(viewPath, 'utf-8');
  const lines = content.trim().split('\n').length;
  assert.ok(
    lines >= 10 && lines <= 20,
    `v-swarm-social.vue must be strictly between 10 and 20 lines (actual: ${lines})`
  );

  // Check declarative Table-of-Contents structure
  assert.ok(content.includes('<template #header>'), 'Must provide #header slot');
  assert.ok(content.includes('<template #left>'), 'Must provide #left slot');
  assert.ok(content.includes('<template #default>'), 'Must provide #default slot');
  assert.ok(content.includes('<template #right>'), 'Must provide #right slot');

  // Check no raw DOM in view
  const rawTags = ['div', 'span', 'button', 'p', 'input', 'section', 'aside', 'header', 'main'];
  const tagPattern = new RegExp(`<(${rawTags.join('|')})\\b`, 'i');
  const templateMatch = content.match(/<template>([\s\S]*?)<\/template>/);
  assert.ok(templateMatch, 'v-swarm-social.vue must have <template>');
  const match = templateMatch[1].match(tagPattern);
  assert.strictEqual(match, null, `Forbidden raw DOM in v-swarm-social: ${match?.[1]}`);
});

test('ADVERSARIAL 4: Zero setInterval calls in ANY file in src/ui', () => {
  const files = getAllFiles(UI_DIR);
  const violations = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    if (content.includes('setInterval')) {
      violations.push(path.relative(process.cwd(), file));
    }
  }

  assert.strictEqual(
    violations.length,
    0,
    `Forbidden setInterval found in files: ${JSON.stringify(violations)}`
  );
});

test('ADVERSARIAL 5: Public entry points and capsule index barrels exist and are well-formed', () => {
  const rootIndex = path.join(UI_DIR, 'index.ts');
  assert.ok(fs.existsSync(rootIndex), 'src/ui/index.ts must exist');

  const expectedCapsules = [
    'atoms/a-avatar',
    'atoms/a-badge',
    'atoms/a-button',
    'atoms/a-card',
    'atoms/a-chip',
    'molecules/m-agent-card',
    'molecules/m-feed-post',
    'molecules/m-lock-chip',
    'molecules/m-token-stat',
    'organisms/o-agent-rail',
    'organisms/o-social-feed',
    'organisms/o-workload-rail',
    'templates/t-social-layout'
  ];

  for (const capsule of expectedCapsules) {
    const idx = path.join(UI_DIR, capsule, 'index.ts');
    assert.ok(fs.existsSync(idx), `Missing barrel entry point for capsule ${capsule}`);
    const content = fs.readFileSync(idx, 'utf-8');
    assert.ok(content.length > 0, `Barrel index for ${capsule} is empty`);
  }
});
