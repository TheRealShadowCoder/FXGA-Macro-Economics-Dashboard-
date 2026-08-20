import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('./server.js', import.meta.url);
let source = await readFile(file, 'utf8');
const injectedMarker = 'FXGA_FAST_ROUTE_V3';
const markerCandidates = ['\nconst s=await liteState()', '\n  const s=await liteState()'];
const marker = markerCandidates.find((candidate) => source.includes(candidate));

if (!marker) {
  throw new Error('FXGA API optimizer could not find liteState route marker in compact or formatted server source');
}

if (!source.includes(injectedMarker)) {
  const fastRoutes = `
// FXGA_FAST_ROUTE_V3
// Latency-sensitive routes return before generic liteState fan-out. This keeps
// Cloud Run cold starts bounded and restores exact browser/API payload contracts.
if(url.pathname==='/api/dashboard'){
  const [calendarState,macroState,marketState,newsState]=await Promise.all([readState('calendar'),readState('macro'),readState('market'),readState('news')]);
  const events=Array.isArray(calendarState?.payload?.events)?calendarState.payload.events:[];
  const observations=(Array.isArray(macroState?.payload?.observations)?macroState.payload.observations:[]).map(normalizeObservation);
  const market=marketState?.payload??{generatedAt:null,source:'FXGA Google Cloud market state',assets:[]};
  const now=Date.now(),calendar=events.filter(e=>Date.parse(e.date)>=now-7*86400000).slice(0,600);
  const news=Array.isArray(newsState?.payload?.items)?newsState.payload.items:[];
  return sendJson(res,200,{generatedAt:macroState?.payload?.generatedAt??macroState?.updatedAt??market?.generatedAt??new Date().toISOString(),macro:observations.slice(0,80),calendar,market:Array.isArray(market.assets)?market.assets:[],news,sources:SOURCE_VIEW,errors:[],transport:{route:'fast-dashboard',unrelatedStateReadsSkipped:['technical','event-studies','intelligence']}},'public, max-age=3');
}
if(url.pathname==='/api/analysis'||url.pathname==='/api/economy-analysis'||url.pathname==='/api/release-impact'){
  const intel=(await readState('intelligence'))?.payload;
  if(!intel)return apiError(res,503,'Intelligence snapshot is not initialized');
  if(url.pathname==='/api/analysis')return intel.macroAnalysis?sendJson(res,200,intel.macroAnalysis,'public, max-age=5'):apiError(res,503,'Analysis snapshot is not initialized');
  if(url.pathname==='/api/economy-analysis')return intel.economyAnalysis?sendJson(res,200,intel.economyAnalysis,'public, max-age=5'):apiError(res,503,'Economy analysis is not initialized');
  return intel.releaseImpact?sendJson(res,200,intel.releaseImpact,'public, max-age=5'):apiError(res,503,'Release impact is not initialized');
}
if(url.pathname==='/api/news'){
  const news=(await readState('news'))?.payload;
  return sendJson(res,200,{items:Array.isArray(news?.items)?news.items:[],mode:'google-cloud-direct',transport:{route:'fast-news'}},'public, max-age=10');
}
if(url.pathname==='/api/fred/catalog'){
  const macroState=await readState('macro');
  const observations=(Array.isArray(macroState?.payload?.observations)?macroState.payload.observations:[]).map(normalizeObservation);
  const counts=new Map();
  for(const row of observations)for(const raw of row.categories||[]){const id=String(raw||'').trim().toLowerCase();if(id)counts.set(id,(counts.get(id)||0)+1);}
  const title=id=>id.replaceAll('_',' ').replaceAll('-',' ').replace(/\\b\\w/g,m=>m.toUpperCase());
  const categories=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([id,count])=>({id,label:title(id),description:'Decision-relevant '+title(id).toLowerCase()+' indicators from the persisted macro dataset.',count}));
  const series=observations.map(x=>({id:x.seriesId,title:x.title,units:x.units,frequency:x.frequency,categories:x.categories}));
  return sendJson(res,200,{total:series.length,maxSeriesPerRequest:16,categories,series,policy:{importantOnly:true,scope:'persisted primary-source macro data'}},'public, max-age=30');
}
if(url.pathname==='/api/event-study-sources'){
  const [macroState,marketState,eventStudyState,calendarState]=await Promise.all([readState('macro'),readState('market'),readState('event-studies'),readState('calendar')]);
  const observations=(Array.isArray(macroState?.payload?.observations)?macroState.payload.observations:[]).map(normalizeObservation);
  const market=marketState?.payload??{generatedAt:null,assets:[]};
  const marketAssets=Array.isArray(market.assets)?market.assets:[];
  const cnbcAssets=marketAssets.filter(asset=>{
    const stack=Array.isArray(asset?.sourceStack)?asset.sourceStack:[];
    return String(asset?.source||'').toUpperCase().includes('CNBC')||String(asset?.fallbackSource||'').toUpperCase().includes('CNBC')||stack.some(item=>String(item||'').toUpperCase().includes('CNBC'));
  });
  const eventResearch=eventStudyState?.payload??{};
  const calendarEvents=Array.isArray(calendarState?.payload?.events)?calendarState.payload.events:[];
  const fredSeries=observations.slice(0,80).map(row=>({seriesId:row.seriesId,title:row.title,value:row.value,date:row.date,previous:row.previous,change:row.change,units:row.units,frequency:row.frequency,categories:row.categories,source:row.source||'FRED'}));
  const cnbcQuotes=cnbcAssets.slice(0,40).map(asset=>({id:asset.id,symbol:asset.symbol,label:asset.label,price:asset.price,change:asset.change,changePercent:asset.changePercent,fetchedAt:asset.fetchedAt,source:asset.source,sourceStack:asset.sourceStack??null,fallbackSource:asset.fallbackSource??null}));
  const studyCount=Number(eventResearch.studyCount??eventResearch.summary?.studies??0);
  return sendJson(res,200,{
    generatedAt:new Date().toISOString(),
    architecture:'FXStreet release history + FRED macro evidence + MetaTrader5 canonical M1 price paths + CNBC independent current cross-asset context',
    sources:{
      fred:{status:fredSeries.length?'live':'degraded',role:'primary macro-series evidence',generatedAt:macroState?.payload?.generatedAt??macroState?.updatedAt??null,seriesCount:fredSeries.length,series:fredSeries},
      cnbc:{status:cnbcQuotes.length?'live':'degraded',role:'independent current cross-asset market cross-check',generatedAt:market?.generatedAt??marketState?.updatedAt??null,assetCount:cnbcQuotes.length,quotes:cnbcQuotes},
      fxstreet:{status:calendarEvents.length?'live':'degraded',role:'economic release calendar and actual/consensus/previous history',generatedAt:calendarState?.payload?.generatedAt??calendarState?.updatedAt??null,eventCount:calendarEvents.length},
      mt5:{status:studyCount>0?'live':'warming',role:'historical before/after-release canonical M1 price-path authority',generatedAt:eventResearch.generatedAt??eventStudyState?.updatedAt??null,studyCount,priceUniverse:eventResearch.priceUniverse??[],preNewsWindows:eventResearch.preNewsWindows??[],horizons:eventResearch.horizons??[]}
    },
    policy:{fred:'FRED macro observations enrich economic context and never overwrite the recorded release actual/consensus fields.',cnbc:'CNBC is an independent current market cross-check; it is not treated as a historical event candle.',mt5:'Only verified MT5 M1 observations are used to calculate historical pre-news and post-release price paths.',missingData:'Unavailable evidence remains unavailable; no prices or release values are synthesized.'}
  },'public, max-age=10');
}
`;
  source = source.replace(marker, `${fastRoutes}${marker}`);
}

await writeFile(file, source, 'utf8');
console.log('Injected FXGA fast routes v3, macro catalog and event-study source fusion');
