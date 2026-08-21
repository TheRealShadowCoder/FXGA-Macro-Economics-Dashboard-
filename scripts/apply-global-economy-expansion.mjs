import fs from 'node:fs';
// Trigger the already-installed verified expansion workflow.

function replaceOne(source,before,after,label){const count=source.split(before).length-1;if(count!==1)throw new Error(`${label}: expected one match, found ${count}`);return source.replace(before,after);}

// Expand the macro state engine.
{
  const path='cloud-run-collector/src/super-economist-core.js';
  let s=fs.readFileSync(path,'utf8');
  s=replaceOne(s,
`export const TARGET_ECONOMIES = ['USA','EUROPE','UK','SOUTH_AFRICA','JAPAN'];
const ECONOMY_META = {
  USA:{label:'United States',currency:'USD',centralBank:'Federal Reserve'},
  EUROPE:{label:'Euro Area',currency:'EUR',centralBank:'European Central Bank'},
  UK:{label:'United Kingdom',currency:'GBP',centralBank:'Bank of England'},
  SOUTH_AFRICA:{label:'South Africa',currency:'ZAR',centralBank:'South African Reserve Bank'},
  JAPAN:{label:'Japan',currency:'JPY',centralBank:'Bank of Japan'},
};`,
`export const TARGET_ECONOMIES = ['USA','EUROPE','UK','SOUTH_AFRICA','JAPAN','CANADA','AUSTRALIA','NEW_ZEALAND','SWITZERLAND','CHINA','INDIA','BRAZIL','MEXICO','SOUTH_KOREA','INDONESIA','SAUDI_ARABIA','TURKEY','ARGENTINA','SINGAPORE','NORWAY','SWEDEN'];
const ECONOMY_META = {
  USA:{label:'United States',currency:'USD',centralBank:'Federal Reserve'},
  EUROPE:{label:'Euro Area',currency:'EUR',centralBank:'European Central Bank'},
  UK:{label:'United Kingdom',currency:'GBP',centralBank:'Bank of England'},
  SOUTH_AFRICA:{label:'South Africa',currency:'ZAR',centralBank:'South African Reserve Bank'},
  JAPAN:{label:'Japan',currency:'JPY',centralBank:'Bank of Japan'},
  CANADA:{label:'Canada',currency:'CAD',centralBank:'Bank of Canada'},
  AUSTRALIA:{label:'Australia',currency:'AUD',centralBank:'Reserve Bank of Australia'},
  NEW_ZEALAND:{label:'New Zealand',currency:'NZD',centralBank:'Reserve Bank of New Zealand'},
  SWITZERLAND:{label:'Switzerland',currency:'CHF',centralBank:'Swiss National Bank'},
  CHINA:{label:'China',currency:'CNY',centralBank:"People's Bank of China"},
  INDIA:{label:'India',currency:'INR',centralBank:'Reserve Bank of India'},
  BRAZIL:{label:'Brazil',currency:'BRL',centralBank:'Central Bank of Brazil'},
  MEXICO:{label:'Mexico',currency:'MXN',centralBank:'Bank of Mexico'},
  SOUTH_KOREA:{label:'South Korea',currency:'KRW',centralBank:'Bank of Korea'},
  INDONESIA:{label:'Indonesia',currency:'IDR',centralBank:'Bank Indonesia'},
  SAUDI_ARABIA:{label:'Saudi Arabia',currency:'SAR',centralBank:'Saudi Central Bank'},
  TURKEY:{label:'Türkiye',currency:'TRY',centralBank:'Central Bank of the Republic of Türkiye'},
  ARGENTINA:{label:'Argentina',currency:'ARS',centralBank:'Central Bank of Argentina'},
  SINGAPORE:{label:'Singapore',currency:'SGD',centralBank:'Monetary Authority of Singapore'},
  NORWAY:{label:'Norway',currency:'NOK',centralBank:'Norges Bank'},
  SWEDEN:{label:'Sweden',currency:'SEK',centralBank:'Sveriges Riksbank'},
};`, 'target economy registry');
  fs.writeFileSync(path,s);
}

// Expand FRED discovery without making each new economy hand-maintained.
{
  const path='cloud-run-collector/src/global-fred.js';
  let s=fs.readFileSync(path,'utf8');
  const marker='const ECONOMY_TERMS = {';
  const extension=`const EXTENDED_ECONOMY_LABELS = {\n  CANADA:'Canada',AUSTRALIA:'Australia',NEW_ZEALAND:'New Zealand',SWITZERLAND:'Switzerland',CHINA:'China',INDIA:'India',BRAZIL:'Brazil',MEXICO:'Mexico',SOUTH_KOREA:'South Korea',INDONESIA:'Indonesia',SAUDI_ARABIA:'Saudi Arabia',TURKEY:'Turkey',ARGENTINA:'Argentina',SINGAPORE:'Singapore',NORWAY:'Norway',SWEDEN:'Sweden',\n};\nfor (const [economy,label] of Object.entries(EXTENDED_ECONOMY_LABELS)) {\n  ECONOMY_SEARCHES[economy] = [\n    ['inflation',\\`${'${label}'} consumer price inflation CPI\\`],\n    ['unemployment',\\`${'${label}'} unemployment rate employment\\`],\n    ['growth',\\`${'${label}'} real GDP economic growth\\`],\n    ['policy-rate',\\`${'${label}'} central bank policy interest rate\\`],\n    ['industrial',\\`${'${label}'} industrial production manufacturing\\`],\n    ['trade',\\`${'${label}'} trade balance current account\\`],\n  ];\n}\n\n`;
  s=replaceOne(s,marker,extension+marker,'extended FRED search insertion');
  s=replaceOne(s,
`const ECONOMY_MINIMUM = { USA:10, EUROPE:14, UK:14, SOUTH_AFRICA:14, JAPAN:14 };`,
`for (const [economy,label] of Object.entries(EXTENDED_ECONOMY_LABELS)) ECONOMY_TERMS[economy]=new RegExp(label.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g,'\\\\$&'),'i');\nconst ECONOMY_MINIMUM = Object.fromEntries(Object.keys(ECONOMY_SEARCHES).map(economy=>[economy,economy==='USA'?10:['EUROPE','UK','SOUTH_AFRICA','JAPAN'].includes(economy)?14:5]));`,
'extended economy minimums');
  s=replaceOne(s,`const maxSeries=Math.min(Math.max(Number(options.maxSeries||180),110),220);`,`const maxSeries=Math.min(Math.max(Number(options.maxSeries||260),150),360);`,'global FRED capacity');
  fs.writeFileSync(path,s);
}
console.log('Expanded global economy registry and FRED discovery to 21 economies.');
