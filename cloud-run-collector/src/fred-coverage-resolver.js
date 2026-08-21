import crypto from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { summarizeUniverse } from './global-fred.js';

const db=new Firestore({ignoreUndefinedProperties:true});
const state=db.collection('fxga_collector_state');
const FRED_API_KEY=String(process.env.FRED_API_KEY||'').trim();
const MIN_REQUEST_INTERVAL_MS=1050;
const MAX_REPAIRS=Math.min(32,Math.max(4,Number(process.env.FRED_COVERAGE_MAX_REPAIRS||24)));
const MAX_UNIVERSE=Math.min(320,Math.max(180,Number(process.env.FRED_COVERAGE_MAX_UNIVERSE||240)));
const TARGET_PER_CATEGORY=Math.min(2,Math.max(1,Number(process.env.FRED_COVERAGE_TARGET_PER_CATEGORY||1)));
const MAX_SERIES_AGE_DAYS=365*5;
let nextRequestAt=0;

const ECONOMY_LABEL={
  USA:'United States',
  EUROPE:'Euro Area',
  UK:'United Kingdom',
  SOUTH_AFRICA:'South Africa',
  JAPAN:'Japan',
};

const REQUIRED_SEARCHES={
  USA:[
    ['inflation','United States consumer price index CPI inflation'],['core-inflation','United States core CPI inflation'],
    ['pce-inflation','United States PCE price index inflation'],['employment','United States nonfarm payroll employment'],
    ['unemployment','United States unemployment rate'],['participation','United States labor force participation rate'],
    ['wages','United States average hourly earnings wages'],['growth','United States real gross domestic product GDP'],
    ['industry','United States industrial production'],['retail','United States retail sales'],
    ['housing','United States housing starts building permits'],['producer-prices','United States producer price index PPI'],
    ['money','United States M2 money supply'],['policy-rate','United States federal funds policy rate'],
    ['bond-yield','United States 10 year Treasury yield'],['trade','United States trade balance'],
    ['current-account','United States current account'],['confidence','United States consumer sentiment confidence'],
    ['income','United States real disposable personal income'],['savings','United States personal saving rate'],
    ['credit','United States bank credit commercial loans'],
  ],
  EUROPE:[
    ['inflation','Euro Area harmonised consumer prices HICP inflation'],['core-inflation','Euro Area core inflation HICP'],
    ['employment','Euro Area employment'],['unemployment','Euro Area unemployment rate'],
    ['wages','Euro Area wages compensation employees'],['growth','Euro Area real GDP'],
    ['industry','Euro Area industrial production'],['manufacturing','Euro Area manufacturing production'],
    ['retail','Euro Area retail sales'],['producer-prices','Euro Area producer price index'],
    ['money','Euro Area M3 money supply'],['policy-rate','European Central Bank policy interest rate'],
    ['bond-yield','Euro Area 10 year government bond yield'],['trade','Euro Area trade balance'],
    ['current-account','Euro Area current account'],['confidence','Euro Area economic sentiment confidence'],
    ['housing','Euro Area house prices'],['credit','Euro Area private sector credit bank lending'],
  ],
  UK:[
    ['inflation','United Kingdom consumer price index CPI inflation'],['core-inflation','United Kingdom core inflation CPI'],
    ['employment','United Kingdom employment'],['unemployment','United Kingdom unemployment rate'],
    ['wages','United Kingdom average earnings wages'],['growth','United Kingdom real GDP'],
    ['industry','United Kingdom industrial production'],['manufacturing','United Kingdom manufacturing production'],
    ['retail','United Kingdom retail sales'],['producer-prices','United Kingdom producer price index'],
    ['money','United Kingdom M4 money supply'],['policy-rate','Bank of England policy rate bank rate'],
    ['bond-yield','United Kingdom 10 year government bond yield'],['trade','United Kingdom trade balance'],
    ['current-account','United Kingdom current account'],['confidence','United Kingdom consumer confidence'],
    ['housing','United Kingdom house prices'],['credit','United Kingdom private sector credit bank lending'],
    ['public-finance','United Kingdom public sector borrowing government debt'],
  ],
  SOUTH_AFRICA:[
    ['inflation','South Africa consumer price index CPI inflation'],['core-inflation','South Africa core inflation CPI'],
    ['employment','South Africa employment'],['unemployment','South Africa unemployment rate'],
    ['wages','South Africa wages earnings'],['growth','South Africa real GDP'],
    ['industry','South Africa industrial production'],['manufacturing','South Africa manufacturing production'],
    ['mining','South Africa mining production'],['retail','South Africa retail sales'],
    ['producer-prices','South Africa producer price index PPI'],['money','South Africa M3 money supply'],
    ['policy-rate','South Africa repo rate SARB'],['bond-yield','South Africa 10 year government bond yield'],
    ['trade','South Africa trade balance'],['current-account','South Africa current account'],
    ['confidence','South Africa business confidence'],['consumer-confidence','South Africa consumer confidence'],
    ['currency','South African rand exchange rate'],['reserves','South Africa foreign exchange reserves'],
  ],
  JAPAN:[
    ['inflation','Japan consumer price index CPI inflation'],['core-inflation','Japan core consumer price inflation'],
    ['employment','Japan employment'],['unemployment','Japan unemployment rate'],
    ['wages','Japan wages earnings'],['growth','Japan real GDP'],
    ['industry','Japan industrial production'],['retail','Japan retail sales'],
    ['household-spending','Japan household consumption spending'],['producer-prices','Japan producer price index corporate goods prices'],
    ['money','Japan M2 money stock'],['monetary-base','Japan monetary base'],
    ['policy-rate','Bank of Japan policy interest rate'],['bond-yield','Japan 10 year government bond yield JGB'],
    ['trade','Japan trade balance'],['current-account','Japan current account'],
    ['confidence','Japan consumer confidence'],['business-confidence','Japan Tankan business conditions'],
    ['machinery','Japan machinery orders'],['housing','Japan housing starts'],
  ],
};

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const clean=value=>String(value??'').trim();
const words=value=>new Set(clean(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(word=>word.length>2));

async function getDoc(name){const snap=await state.doc(name).get();return snap.exists?snap.data():null;}
async function throttledFetch(url,timeoutMs=10000){
  const wait=Math.max(0,nextRequestAt-Date.now());if(wait)await sleep(wait);nextRequestAt=Date.now()+MIN_REQUEST_INTERVAL_MS;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'FXGA-FRED-Coverage-Resolver/1.0'},signal:controller.signal});
    if(!response.ok)throw new Error(`FRED HTTP ${response.status}`);
    return await response.json();
  }finally{clearTimeout(timer);}
}

function scoreSeries(series,{economy,category,query,title}){
  const text=`${series.title||''} ${series.notes||''}`.toLowerCase();
  const economyWords=words(ECONOMY_LABEL[economy]||economy),queryWords=words(`${query||''} ${category||''} ${title||''}`);
  let score=0;
  for(const word of economyWords)if(text.includes(word))score+=8;
  for(const word of queryWords)if(text.includes(word))score+=2;
  const frequency=clean(series.frequency).toLowerCase();
  if(/monthly/.test(frequency))score+=18;else if(/quarterly/.test(frequency))score+=16;else if(/weekly/.test(frequency))score+=14;else if(/daily/.test(frequency))score+=12;else if(/annual/.test(frequency))score+=3;
  const end=Date.parse(series.observation_end||'');
  if(Number.isFinite(end)){
    const ageDays=(Date.now()-end)/86400000;
    if(ageDays<=730)score+=24;else if(ageDays<=MAX_SERIES_AGE_DAYS)score+=8;else score-=30;
  }
  score+=Math.min(20,Number(series.popularity||0)*0.2);
  if(/forecast|projection|estimate|discontinued|annual percentage change in/.test(text))score-=18;
  return score;
}

async function searchFred({economy,category,query,title,excludeIds}){
  const url=new URL('https://api.stlouisfed.org/fred/series/search');
  url.searchParams.set('api_key',FRED_API_KEY);url.searchParams.set('file_type','json');
  url.searchParams.set('search_text',clean(query||`${ECONOMY_LABEL[economy]||economy} ${title||category}`));
  url.searchParams.set('limit','20');url.searchParams.set('order_by','search_rank');
  const payload=await throttledFetch(url,12000);
  return (payload.seriess||[])
    .filter(series=>series?.id&&!excludeIds.has(series.id))
    .filter(series=>{const end=Date.parse(series.observation_end||'');return !Number.isFinite(end)||end>=Date.now()-MAX_SERIES_AGE_DAYS*86400000;})
    .map(series=>({series,score:scoreSeries(series,{economy,category,query,title})}))
    .sort((a,b)=>b.score-a.score);
}

async function validateSeries(seriesId){
  const url=new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id',seriesId);url.searchParams.set('api_key',FRED_API_KEY);url.searchParams.set('file_type','json');
  url.searchParams.set('sort_order','desc');url.searchParams.set('limit','12');
  const payload=await throttledFetch(url,12000);
  const numeric=(payload.observations||[]).filter(row=>row?.value!=='.'&&Number.isFinite(Number(row.value)));
  if(!numeric.length)throw new Error('No current numeric FRED observations');
  return {latestDate:numeric[0]?.date||null,observations:numeric.length};
}

async function bestReplacement(target,usedIds){
  const candidates=await searchFred({...target,excludeIds:usedIds});
  for(const candidate of candidates.slice(0,5)){
    try{
      const validation=await validateSeries(candidate.series.id);
      return {candidate:candidate.series,score:candidate.score,validation};
    }catch{}
  }
  return null;
}

function descriptorFromCandidate(candidate,target,extra={}){
  return {
    seriesId:candidate.id,title:candidate.title||candidate.id,units:candidate.units_short||candidate.units||'',frequency:candidate.frequency||'',
    seasonalAdjustment:candidate.seasonal_adjustment||'',lastUpdated:candidate.last_updated||'',economy:target.economy,category:target.category,
    popularity:Number(candidate.popularity||0),source:'FRED coverage repair',curated:false,...extra,
  };
}

function coverageCounts(series){
  const counts=new Map();for(const item of series){const key=`${item.economy||'UNKNOWN'}:${item.category||'other'}`;counts.set(key,(counts.get(key)||0)+1);}return counts;
}

export async function repairFredCoverage({reason='cloud-run-startup'}={}){
  const startedAt=Date.now();
  if(!FRED_API_KEY)return {skipped:true,reason:'FRED_API_KEY not configured'};
  const [universeState,macroState]=await Promise.all([getDoc('fred-universe'),getDoc('macro')]);
  const universe=universeState?.payload;
  if(!Array.isArray(universe?.series)||!universe.series.length)return {skipped:true,reason:'FRED universe not initialized'};

  let series=[...universe.series],repairs=[],unresolved=[];
  const usedIds=new Set(series.map(item=>item.seriesId).filter(Boolean));
  const failures=Array.isArray(macroState?.payload?.failures)?macroState.payload.failures:[];
  const repairableFailures=failures.filter(failure=>['series-unavailable','no-current-observation'].includes(failure.type)).slice(0,MAX_REPAIRS);

  for(const failure of repairableFailures){
    if(repairs.length>=MAX_REPAIRS)break;
    const index=series.findIndex(item=>item.seriesId===failure.seriesId);if(index<0)continue;
    const descriptor=series[index],target={economy:descriptor.economy||failure.economy||'USA',category:descriptor.category||failure.category||'other',title:descriptor.title||failure.title||descriptor.seriesId,query:`${ECONOMY_LABEL[descriptor.economy||failure.economy]||descriptor.economy||failure.economy||''} ${descriptor.title||failure.title||descriptor.category||failure.category||''}`};
    usedIds.delete(descriptor.seriesId);
    const replacement=await bestReplacement(target,usedIds).catch(()=>null);
    if(!replacement){usedIds.add(descriptor.seriesId);unresolved.push({kind:'failed-series',seriesId:descriptor.seriesId,economy:target.economy,category:target.category});continue;}
    const next=descriptorFromCandidate(replacement.candidate,target,{replacesSeriesId:descriptor.seriesId,repairReason:failure.type,repairScore:Number(replacement.score.toFixed(2)),validatedAt:new Date().toISOString()});
    series[index]=next;usedIds.add(next.seriesId);repairs.push({kind:'replace',from:descriptor.seriesId,to:next.seriesId,economy:target.economy,category:target.category});
  }

  let counts=coverageCounts(series);
  const missing=[];
  for(const [economy,searches] of Object.entries(REQUIRED_SEARCHES))for(const [category,query] of searches){const key=`${economy}:${category}`,count=counts.get(key)||0;if(count<TARGET_PER_CATEGORY)missing.push({economy,category,query,needed:TARGET_PER_CATEGORY-count});}

  for(const target of missing){
    for(let n=0;n<target.needed;n++){
      if(repairs.length>=MAX_REPAIRS||series.length>=MAX_UNIVERSE)break;
      const replacement=await bestReplacement(target,usedIds).catch(()=>null);
      if(!replacement){unresolved.push({kind:'missing-category',economy:target.economy,category:target.category});break;}
      const next=descriptorFromCandidate(replacement.candidate,target,{repairReason:'missing-category',repairScore:Number(replacement.score.toFixed(2)),validatedAt:new Date().toISOString()});
      series.push(next);usedIds.add(next.seriesId);repairs.push({kind:'add',to:next.seriesId,economy:target.economy,category:target.category});counts.set(`${target.economy}:${target.category}`,(counts.get(`${target.economy}:${target.category}`)||0)+1);
    }
    if(repairs.length>=MAX_REPAIRS||series.length>=MAX_UNIVERSE)break;
  }

  counts=coverageCounts(series);
  const categoriesRequired=Object.values(REQUIRED_SEARCHES).reduce((sum,list)=>sum+list.length,0);
  const categoriesCovered=Object.entries(REQUIRED_SEARCHES).reduce((sum,[economy,searches])=>sum+searches.filter(([category])=>(counts.get(`${economy}:${category}`)||0)>=TARGET_PER_CATEGORY).length,0);
  const generatedAt=new Date().toISOString();
  const coverageRepair={
    schema:'fxga.fred.coverage-repair.v1',generatedAt,reason,targetPerCategory:TARGET_PER_CATEGORY,maxUniverse:MAX_UNIVERSE,
    failuresExamined:repairableFailures.length,repairs,repairCount:repairs.length,unresolved:unresolved.slice(0,40),unresolvedCount:unresolved.length,
    categoriesRequired,categoriesCovered,categoriesMissing:Math.max(0,categoriesRequired-categoriesCovered),coveragePercent:Number(((categoriesCovered/Math.max(1,categoriesRequired))*100).toFixed(1)),durationMs:Date.now()-startedAt,
  };
  const payload={...universe,generatedAt,series,summary:summarizeUniverse(series),coverageRepair};
  const serialized=JSON.stringify(payload),updatedAt=generatedAt;
  await state.doc('fred-universe').set({hash:hash(serialized),updatedAt,payload},{merge:false});
  await state.doc('fred-coverage-repair').set({hash:hash(coverageRepair),updatedAt,payload:coverageRepair},{merge:false});
  console.log('FRED COVERAGE REPAIR',JSON.stringify({series:series.length,repairs:repairs.length,categoriesCovered,categoriesRequired,categoriesMissing:coverageRepair.categoriesMissing,unresolved:unresolved.length,durationMs:coverageRepair.durationMs}));
  return coverageRepair;
}
