// Inlines the src modules into src/template.html, writing
// ../gedcom-family-tree.html. Run: node src/build.mjs
//
// The modules are plain ES modules so Node can test them directly; inlining
// strips their local imports and their export block, because in the built file
// they share one module scope.
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const MODULES = ['gedcom.js', 'validate.js', 'layout.js'];

let html = readFileSync(join(here, 'template.html'), 'utf8');

for (const name of MODULES) {
  const src = readFileSync(join(here, name), 'utf8')
    .replace(/^import\s+[\s\S]*?from\s+'\.\/[\w.]+';\s*$/gm, '')   // local imports
    .replace(/^export\s*\{[\s\S]*?\};\s*$/gm, '')                  // export block
    .trim();
  const marker = '//@@INLINE ' + name;
  if (!html.includes(marker)) throw new Error('missing marker for ' + name);
  // Function form: the source contains $-sequences, which are replacement patterns.
  html = html.replace(marker, () => src);
}

if (/@@INLINE/.test(html)) throw new Error('unresolved inline marker');
if (/^\s*import\s/m.test(html.slice(html.indexOf('<script type="module">')))) {
  throw new Error('an import survived inlining');
}

const out = join(here, '..', 'gedcom-family-tree.html');
writeFileSync(out, html);
console.log('built gedcom-family-tree.html', html.length, 'bytes');
