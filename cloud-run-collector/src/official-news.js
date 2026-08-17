import { load as loadHtml } from 'cheerio';

const RSS_SOURCES = [
  { id:'fed-press', name:'Federal Reserve Press Releases', url:'https://www.federalreserve.gov/feeds/press_all.xml', category:'Central Bank', region:'United States' },
  { id:'fed-speeches', name:'Federal Reserve Speeches', url:'https://www.federalreserve.gov/feeds/speeches.xml', category:'Central Bank', region:'United States' },
  { id:'ecb-press', name:'European Central Bank Press & Speeches', url:'https://www.ecb.europa.eu/rss/press.html', category:'Central Bank', region:'Euro Area' },
  { id:'ecb-statistics', name:'European Central Bank Statistical Releases', url:'https://www.ecb.europa.eu/rss/statpress.html', category:'Official Statistics', region:'Euro Area' },
  { id:'boe-speeches', name:'Bank of England Speeches', url:'https://www.bankofengland.co.uk/rss/speeches', category:'Central Bank', region:'United Kingdom' },
  { id:'boe-news', name:'Bank of England News', url:'https://www.bankofengland.co.uk/rss/news', category:'Central Bank', region:'United Kingdom' },
  { id:'boe-statistics', name:'Bank of England Statistics', url:'https://www.bankofengland.co.uk/rss/statistics', category:'Official Statistics', region:'United Kingdom' },
  { id:'sarb-publications', name:'South African Reserve Bank Publications', url:'https://www.resbank.co.za/bin/sarb/solr/publications/rss', category:'Central Bank', region:'South Africa' },
  { id:'boj-news', name:'Bank of Japan What’s New', url:'https://www.boj.or.jp/en/rss/whatsnew.xml', category:'Central Bank', region:'Japan' },
  { id:'boj-statistics', name:'Bank of Japan Statistics', url:'https://www.boj.or.jp/en/rss/statistics.xml', category:'Official Statistics', region:'Japan' },
  { id:'bls-latest', name:'U.S. Bureau of Labor Statistics', url:'https://www.bls.gov/feed/bls_latest.rss', category:'Official Statistics', region:'United States' },
];
const HTML_SOURCES = [
  { id:'statssa-releases', name:'Statistics South Africa Press Statements', url:'https://www.statssa.gov.za/?page_id=1307', category:'Official Statistics', region:'South Africa', include:/cpi|ppi|gdp|employment|unemployment|trade|retail|manufactur|mining|business|income|population|price|labou?r|economic/i },
  { id:'japan-stat-whatsnew', name:'Statistics Bureau of Japan What’s New', url:'https://www.stat.go.jp/english/whatsnew/', category:'Official Statistics', region:'Japan', include:/consumer price|cpi|labou?r force|unemployment|household|expenditure|business|services|population|retail|income|econom|price|employment/i },
];

const POLICY_LANGUAGE = {
  hawkish:[['higher for longer',2.3],['further tightening',2.2],['additional tightening',2],['raise rates',1.8],['rate increase',1.6],['upside inflation risks',1.8],['inflation remains elevated',1.4],['inflation is too high',2],['persistent inflation',1.6],['restrictive stance',.9],['strong labour market',.8],['robust growth',.7]],
  dovish:[['rate cuts',1.8],['cut rates',1.8],['policy easing',1.7],['begin easing',1.9],['rate reduction',1.6],['downside growth risks',1.5],['inflation has eased',.9],['inflation is declining',1.2],['labour market cooling',1.1],['weaker demand',.9],['economic activity slowed',1],['less restrictive',1.2],['support the economy',.9]],
};
const NEGATIONS=new Set(['not','no','never','neither','without','unlikely']);
const INTENSIFIERS={very:1.25,significantly:1.35,materially:1.3,substantially:1.35,somewhat:.75,slightly:.65};

function normalize(value=''){return String(value).toLowerCase().replace(/[^a-z0-9%]+/g,' ').replace(/\s+/g,' ').trim();}
function modifierBefore(text,index){const before=text.slice(Math.max(0,index-45),index).trim().split(/\s+/).slice(-4);let modifier=1,negated=false;for(const word of before){if(NEGATIONS.has(word))negated=true;if(INTENSIFIERS[word])modifier*=INTENSIFIERS[word];}return{modifier,negated};}
function policyTone(title='',summary='',category=''){
  if(category!=='Central Bank')return null;
  const text=normalize(`${title}. ${summary}`);let score=0,total=0;const matched=[];
  for(const [side,items] of Object.entries(POLICY_LANGUAGE))for(const [phrase,weight] of items){let start=0,index;while((index=text.indexOf(phrase,start))>=0){const {modifier,negated}=modifierBefore(text,index);const direction=side==='hawkish'?1:-1;const contribution=direction*weight*modifier*(negated?-.65:1);score+=contribution;total+=Math.abs(weight*modifier);matched.push({phrase,side,contribution:Number(contribution.toFixed(2)),negated});start=index+phrase.length;}}
  const normalizedScore=total?Math.max(-100,Math.min(100,score/Math.max(1,total)*100)):0;
  const confidence=Math.min(100,Math.round(25+matched.length*12+Math.min(25,total*4)));
  return{score:Number(normalizedScore.toFixed(1)),stance:normalizedScore>=18?'hawkish':normalizedScore<=-18?'dovish':'balanced',confidence:matched.length?confidence:20,matched:matched.slice(0,8)};
}
function decode(value=''){return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/\s+/g,' ').trim();}
function tag(block,names){for(const name of names){const match=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,'i'));if(match?.[1])return decode(match[1]);}return '';}
function link(block){const rss=tag(block,['link']);if(rss.startsWith('http'))return rss;return block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1]||rss;}
function stableId(value){let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16);}
function controllerFor(ms=7500){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),ms);return{controller,timer};}
function enrich(item){const tone=policyTone(item.title,item.summary,item.category);return tone?{...item,policyTone:tone}:item;}
async function fetchFeed(source){const{controller,timer}=controllerFor();try{const response=await fetch(source.url,{headers:{'User-Agent':'FXGA-Macro-Research/4.1',Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml'},signal:controller.signal});if(!response.ok)throw new Error(`${source.name} HTTP ${response.status}`);const xml=await response.text(),blocks=[...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m=>m[2]);return blocks.slice(0,35).map(block=>{const title=tag(block,['title'])||'Untitled update',itemLink=link(block),publishedAt=tag(block,['pubDate','published','updated','dc:date']),summary=tag(block,['description','summary','content:encoded','content']);return enrich({id:`${source.id}-${stableId(`${title}|${itemLink}|${publishedAt}`)}`,sourceId:source.id,sourceName:source.name,title,link:itemLink,publishedAt,summary:summary.slice(0,700),category:source.category,region:source.region});});}finally{clearTimeout(timer);}}
async function fetchHtmlSource(source){const{controller,timer}=controllerFor(9000);try{const response=await fetch(source.url,{headers:{'User-Agent':'FXGA-Macro-Research/4.1',Accept:'text/html,application/xhtml+xml'},signal:controller.signal,redirect:'follow'});if(!response.ok)throw new Error(`${source.name} HTTP ${response.status}`);const $=loadHtml(await response.text()),items=[],seen=new Set();$('a').each((_,a)=>{if(items.length>=35)return;const title=$(a).text().replace(/\s+/g,' ').trim(),href=$(a).attr('href');if(!href||title.length<10||!source.include.test(title))return;let itemLink;try{itemLink=new URL(href,source.url).toString();}catch{return;}const key=`${title}|${itemLink}`;if(seen.has(key))return;seen.add(key);const context=$(a).closest('li,article,tr,p,div').first().text().replace(/\s+/g,' ').trim().slice(0,700),dateMatch=context.match(/(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[., ]+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2}/i);const parsed=dateMatch?Date.parse(dateMatch[0]):NaN,publishedAt=Number.isFinite(parsed)?new Date(parsed).toISOString():'';items.push(enrich({id:`${source.id}-${stableId(key)}`,sourceId:source.id,sourceName:source.name,title,link:itemLink,publishedAt,summary:context&&context!==title?context:'',category:source.category,region:source.region}));});return items;}finally{clearTimeout(timer);}}
export async function fetchOfficialNews(){const sources=[...RSS_SOURCES,...HTML_SOURCES],tasks=[...RSS_SOURCES.map(fetchFeed),...HTML_SOURCES.map(fetchHtmlSource)],results=await Promise.allSettled(tasks),items=[],health={};results.forEach((r,i)=>{const source=sources[i];if(r.status==='fulfilled'){items.push(...r.value);health[source.id]={ok:true,items:r.value.length,region:source.region};}else health[source.id]={ok:false,items:0,region:source.region,error:String(r.reason?.message||r.reason).slice(0,220)};});const dedup=new Map();for(const item of items)if(!dedup.has(item.id))dedup.set(item.id,item);return{generatedAt:new Date().toISOString(),items:[...dedup.values()].sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0)).slice(0,180),sourceHealth:health,sources:sources.map(({url,include,...rest})=>rest),targetEconomies:['USA','EUROPE','UK','SOUTH_AFRICA','JAPAN']};}
export { RSS_SOURCES, HTML_SOURCES, policyTone };
