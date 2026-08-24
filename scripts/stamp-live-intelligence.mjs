import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('dist/fxga-intelligence-live.html');
const placeholder = '__FXGA_GOOGLE_CLOUD_API_BASE__';
const base = String(process.env.VITE_GOOGLE_CLOUD_API_BASE || '').trim().replace(/\/+$/, '');

if (!fs.existsSync(file)) {
  throw new Error(`Live intelligence page was not copied into the build: ${file}`);
}

let html = fs.readFileSync(file, 'utf8');
if (!html.includes(placeholder)) {
  throw new Error('Live intelligence page is missing its Google Cloud API placeholder.');
}

if (!base) {
  console.warn('VITE_GOOGLE_CLOUD_API_BASE is not set. Leaving the live page unstamped for local build use; supply ?api=https://YOUR-CLOUD-RUN-URL to test it.');
  process.exit(0);
}

let parsed;
try { parsed = new URL(base); } catch { throw new Error('VITE_GOOGLE_CLOUD_API_BASE must be a valid URL.'); }
if (parsed.protocol !== 'https:') throw new Error('The production Google Cloud API base must use HTTPS.');

html = html.split(placeholder).join(base);
if (html.includes(placeholder)) throw new Error('Google Cloud API placeholder remains after stamping.');
fs.writeFileSync(file, html);
console.log(`Stamped FXGA live intelligence page with Google Cloud API: ${parsed.origin}`);
