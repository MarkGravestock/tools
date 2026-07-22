// Inlines src/planlogic.js and src/examples.js into src/template.html, writing
// ../calcite-query-explainer.html. Run: node src/build.mjs   (or npm run build)
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const here = dirname(fileURLToPath(import.meta.url));
let html = readFileSync(join(here, 'template.html'), 'utf8');
for (const f of ['planlogic.js', 'examples.js']) {
  const src = readFileSync(join(here, f), 'utf8').replace(/^export \{[\s\S]*?\};\s*$/m, '');
  html = html.replace('//@@INLINE ' + f, () => src); // fn form: source contains $-sequences
}
if (/@@INLINE/.test(html)) throw new Error('unresolved inline marker');
writeFileSync(join(here, '..', 'calcite-query-explainer.html'), html);
console.log('built calcite-query-explainer.html', html.length, 'bytes');
