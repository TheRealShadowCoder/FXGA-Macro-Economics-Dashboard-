import fs from 'node:fs';
import path from 'node:path';

const files = ['fxga-intelligence-live.html', 'fxga-error-guide.html'].map(name => path.resolve('dist', name));
const placeholder = '__FXGA_GOOGLE_CLOUD_API_BASE__';
const base = String(process.env.VITE_GOOGLE_CLOUD_API_BASE || '').trim().replace(/\/+$/, '');

for (const file of files) {
  if (!fs.existsSync(file)) throw new Error(`FXGA intelligence page was not copied into the build: ${file}`);
  const html = fs.readFileSync(file, 'utf8');
  if (!html.includes(placeholder)) throw new Error(`${path.basename(file)} is missing its Google Cloud API placeholder.`);
}

if (!base) {
  console.warn('VITE_GOOGLE_CLOUD_API_BASE is not set. Leaving FXGA intelligence pages unstamped for local build use; supply ?api=https://YOUR-CLOUD-RUN-URL to test them.');
  process.exit(0);
}

let parsed;
try { parsed = new URL(base); } catch { throw new Error('VITE_GOOGLE_CLOUD_API_BASE must be a valid URL.'); }
if (parsed.protocol !== 'https:') throw new Error('The production Google Cloud API base must use HTTPS.');

for (const file of files) {
  let html = fs.readFileSync(file, 'utf8').split(placeholder).join(base);
  if (html.includes(placeholder)) throw new Error(`Google Cloud API placeholder remains in ${path.basename(file)} after stamping.`);
  fs.writeFileSync(file, html);
}
console.log(`Stamped ${files.length} FXGA intelligence pages with Google Cloud API: ${parsed.origin}`);
