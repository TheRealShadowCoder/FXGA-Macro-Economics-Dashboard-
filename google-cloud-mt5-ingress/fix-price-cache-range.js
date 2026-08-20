import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('./price-cache.js', import.meta.url);
let source = await readFile(file, 'utf8');

const oldFinite = "const finite=value=>{const n=Number(value);return Number.isFinite(n)?n:null;};";
const newFinite = "const finite=value=>{if(value==null||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;};";

if (source.includes(oldFinite)) {
  source = source.replace(oldFinite, newFinite);
} else if (!source.includes(newFinite)) {
  throw new Error('Could not locate MT5 finite-number parser for range fix');
}

const oldRange = "if(fromMs!=null||toMs!=null){fromMs=Math.max(retentionCutoff,fromMs??retentionCutoff);toMs=Math.min(Date.now(),toMs??Date.now());if(toMs<fromMs)throw Object.assign(new Error('MT5 price query to must be greater than or equal to from'),{statusCode:400});}";
const newRange = "if(fromMs!=null||toMs!=null){const nowMs=Date.now();fromMs=Math.max(retentionCutoff,fromMs??retentionCutoff);toMs=Math.min(nowMs,toMs??nowMs);if(toMs<fromMs){if(fromMs>nowMs)fromMs=nowMs;else fromMs=toMs;}}";

if (source.includes(oldRange)) {
  source = source.replace(oldRange, newRange);
} else if (!source.includes(newRange)) {
  throw new Error('Could not locate MT5 date-range normalization block');
}

await writeFile(file, source, 'utf8');
console.log('MT5 price-cache range semantics fixed: missing values stay null; future/reversed windows normalize safely');
