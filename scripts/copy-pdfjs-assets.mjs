// Copy pdf.js cMaps + standard fonts into public/ so CJK and non-embedded
// fonts render correctly in the hosted build. The single-file offline build
// skips these (pdf.js degrades gracefully for the rare PDFs that need them).
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist');
const dest = join(root, 'public', 'pdfjs');

if (!existsSync(src)) {
  console.error('pdfjs-dist not installed; run npm install first');
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
cpSync(join(src, 'cmaps'), join(dest, 'cmaps'), { recursive: true });
cpSync(join(src, 'standard_fonts'), join(dest, 'standard_fonts'), { recursive: true });
console.log('Copied pdf.js cmaps + standard_fonts to public/pdfjs');
