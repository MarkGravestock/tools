// Inlines src/planlogic.js and src/exampledb.js into src/template.html,
// writing ../postgres-query-explainer.html. Run: node src/build.mjs
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const here = dirname(fileURLToPath(import.meta.url));
let html = readFileSync(join(here, 'template.html'), 'utf8');
for (const f of ['planlogic.js', 'exampledb.js']) {
  const src = readFileSync(join(here, f), 'utf8').replace(/^export \{[\s\S]*?\};\s*$/m, '');
  html = html.replace('//@@INLINE ' + f, () => src); // fn form: source contains $-sequences
}
if (/@@INLINE/.test(html)) throw new Error('unresolved inline marker');
writeFileSync(join(here, '..', 'postgres-query-explainer.html'), html);
console.log('built postgres-query-explainer.html', html.length, 'bytes');
