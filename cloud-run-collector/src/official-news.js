const RSS_SOURCES = [
  { id:'fed-press', name:'Federal Reserve Press Releases', url:'https://www.federalreserve.gov/feeds/press_all.xml', category:'Central Bank', region:'United States' },
  { id:'fed-speeches', name:'Federal Reserve Speeches', url:'https://www.federalreserve.gov/feeds/speeches.xml', category:'Central Bank', region:'United States' },
  { id:'ecb-press', name:'European Central Bank Press & Speeches', url:'https://www.ecb.europa.eu/rss/press.html', category:'Central Bank', region:'Euro Area' },
  { id:'ecb-statistics', name:'European Central Bank Statistical Releases', url:'https://www.ecb.europa.eu/rss/statpress.html', category:'Official Statistics', region:'Euro Area' },
  { id:'boe-speeches', name:'Bank of England Speeches', url:'https://www.bankofengland.co.uk/rss/speeches', category:'Central Bank', region:'United Kingdom' },
  { id:'boe-news', name:'Bank of England News', url:'https://www.bankofengland.co.uk/rss/news', category:'Central Bank', region:'United Kingdom' },
  { id:'boe-statistics', name:'Bank of England Statistics', url:'https://www.bankofengland.co.uk/rss/statistics', category:'Official Statistics', region:'United Kingdom' },
  { id:'rba-speeches', name:'Reserve Bank of Australia Speeches', url:'https://www.rba.gov.au/rss/rss-cb-speeches.xml', category:'Central Bank', region:'Australia' },
  { id:'bls-latest', name:'U.S. Bureau of Labor Statistics', url:'https://www.bls.gov/feed/bls_latest.rss', category:'Official Statistics', region:'United States' },
];

function decode(value='') {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
    .replace(/&#39;|&apos;/g,"'").replace(/\s+/g,' ').trim();
}
function tag(block,names){
  for(const name of names){
    const match=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,'i'));
    if(match?.[1]) return decode(match[1]);
  }
  return '';
}
function link(block){
  const rss=tag(block,['link']);
  if(rss.startsWith('http')) return rss;
  return block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1]||rss;
}
function stableId(value){
  let hash=2166136261;
  for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16);
}
async function fetchFeed(source){
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),6500);
  try{
    const response=await fetch(source.url,{headers:{'User-Agent':'FXGA-Google-Super-Economist/3.0',Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml'},signal:controller.signal});
    if(!response.ok) throw new Error(`${source.name} HTTP ${response.status}`);
    const xml=await response.text();
    const blocks=[...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m=>m[2]);
    return blocks.slice(0,25).map(block=>{
      const title=tag(block,['title'])||'Untitled update', itemLink=link(block), publishedAt=tag(block,['pubDate','published','updated','dc:date']);
      const summary=tag(block,['description','summary','content:encoded','content']);
      return {id:`${source.id}-${stableId(`${title}|${itemLink}|${publishedAt}`)}`,sourceId:source.id,sourceName:source.name,title,link:itemLink,publishedAt,summary:summary.slice(0,500),category:source.category,region:source.region};
    });
  } finally { clearTimeout(timer); }
}
export async function fetchOfficialNews(){
  const results=await Promise.allSettled(RSS_SOURCES.map(fetchFeed));
  const items=[], health={};
  results.forEach((r,i)=>{
    const source=RSS_SOURCES[i];
    if(r.status==='fulfilled'){ items.push(...r.value); health[source.id]={ok:true,items:r.value.length}; }
    else health[source.id]={ok:false,items:0,error:String(r.reason?.message||r.reason).slice(0,180)};
  });
  const dedup=new Map();
  for(const item of items) if(!dedup.has(item.id)) dedup.set(item.id,item);
  return {
    generatedAt:new Date().toISOString(),
    items:[...dedup.values()].sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0)).slice(0,120),
    sourceHealth:health,
    sources:RSS_SOURCES.map(({url,...rest})=>rest),
  };
}
export { RSS_SOURCES };
