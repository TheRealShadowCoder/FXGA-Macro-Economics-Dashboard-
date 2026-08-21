import { Firestore } from '@google-cloud/firestore';

const db=new Firestore({ignoreUndefinedProperties:true});
const dynamicEconomies=db.collection('fxga_dynamic_economies');
const FRED_API_KEY=String(process.env.FRED_API_KEY||'').trim();
const CACHE_MS=12*60*60*1000;
const CATEGORIES=[
  {id:'inflation',label:'Inflation',query:'consumer price inflation CPI'},
  {id:'growth',label:'Growth',query:'real GDP economic growth industrial production'},
  {id:'labour',label:'Labour',query:'unemployment rate employment labour'},
  {id:'policy',label:'Policy',query:'central bank policy interest rate'},
  {id:'financial',label:'Financial',query:'trade balance current account credit financial conditions'},
];
const KNOWN={
  KENYA:['KES','Central Bank of Kenya'],NIGERIA:['NGN','Central Bank of Nigeria'],GHANA:['GHS','Bank of Ghana'],EGYPT:['EGP','Central Bank of Egypt'],MOROCCO:['MAD','Bank Al-Maghrib'],
  BOTSWANA:['BWP','Bank of Botswana'],NAMIBIA:['NAD','Bank of Namibia'],MAURITIUS:['MUR','Bank of Mauritius'],ZAMBIA:['ZMW','Bank of Zambia'],ZIMBABWE:['ZWG','Reserve Bank of Zimbabwe'],
  PAKISTAN:['PKR','State Bank of Pakistan'],BANGLADESH:['BDT','Bangladesh Bank'],SRI_LANKA:['LKR','Central Bank of Sri Lanka'],THAILAND:['THB','Bank of Thailand'],MALAYSIA:['MYR','Bank Negara Malaysia'],
  PHILIPPINES:['PHP','Bangko Sentral ng Pilipinas'],VIETNAM:['VND','State Bank of Vietnam'],TAIWAN:['TWD','Central Bank of the Republic of China (Taiwan)'],HONG_KONG:['HKD','Hong Kong Monetary Authority'],
  ISRAEL:['ILS','Bank of Israel'],UNITED_ARAB_EMIRATES:['AED','Central Bank of the UAE'],QATAR:['QAR','Qatar Central Bank'],KUWAIT:['KWD','Central Bank of Kuwait'],
  POLAND:['PLN','National Bank of Poland'],CZECH_REPUBLIC:['CZK','Czech National Bank'],HUNGARY:['HUF','Hungarian National Bank'],ROMANIA:['RON','National Bank of Romania'],
  DENMARK:['DKK','Danmarks Nationalbank'],ICELAND:['ISK','Central Bank of Iceland'],RUSSIA:['RUB','Bank of Russia'],UKRAINE:['UAH','National Bank of Ukraine'],
  CHILE:['CLP','Central Bank of Chile'],COLOMBIA:['COP','Bank of the Republic'],PERU:['PEN','Central Reserve Bank of Peru'],URUGUAY:['UYU','Central Bank of Uruguay'],
};
const ALIASES={
  SOUTH_KOREA:['south korea','republic of korea','korea, republic of'],
  NORTH_KOREA:['north korea','democratic people s republic of korea'],
  CZECH_REPUBLIC:['czech republic','czechia'],
  UNITED_ARAB_EMIRATES:['united arab emirates','uae'],
  HONG_KONG:['hong kong','hong kong sar'],
  TAIWAN:['taiwan','republic of china'],
  TURKEY:['turkey','turkiye','türkiye'],
  RUSSIA:['russia','russian federation'],
  VIETNAM:['vietnam','viet nam'],
  BOLIVIA:['bolivia','plurinational state of bolivia'],
  VENEZUELA:['venezuela','bolivarian republic of venezuela'],
  TANZANIA:['tanzania','united republic of tanzania'],
  COTE_D_IVOIRE:["cote d ivoire","côte d'ivoire",'ivory coast'],
  DEMOCRATIC_REPUBLIC_OF_THE_CONGO:['democratic republic of the congo','dr congo','congo kinshasa'],
  REPUBLIC_OF_THE_CONGO:['republic of the congo','congo brazzaville'],
};

const cleanCountry=value=>String(value||'').trim().replace(/\s+/g,' ').slice(0,80);
const normalizeText=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const economyId=value=>cleanCountry(value).normalize('NFKD').replace(/[^A-Za-z0-9 ]/g,'').trim().replace(/\s+/g,'_').toUpperCase();
const clamp=(x,lo=-100,hi=100)=>Math.max(lo,Math.min(hi,Number.isFinite(x)?x:0));
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
const std=xs=>{if(xs.length<2)return 0;const m=mean(xs);return Math.sqrt(mean(xs.map(x=>(x-m)**2)));};
const ageDays=value=>{const t=Date.parse(value||'');return Number.isFinite(t)?Math.max(0,(Date.now()-t)/86_400_000):Infinity;};
function freshnessLimitDays(frequency=''){
  const f=String(frequency).toLowerCase();
  if(/daily/.test(f))return 30;
  if(/weekly/.test(f))return 75;
  if(/monthly/.test(f))return 150;
  if(/quarter/.test(f))return 400;
  if(/annual/.test(f))return 800;
  return 240;
}
function freshnessScore(date,frequency=''){
  const limit=freshnessLimitDays(frequency),age=ageDays(date);
  if(!Number.isFinite(age))return 0;
  return Math.max(0,Math.min(1,1-age/Math.max(1,limit)));
}
function geographyTerms(country,id){
  const terms=[normalizeText(country),normalizeText(id.replaceAll('_',' ')),...(ALIASES[id]||[]).map(normalizeText)].filter(x=>x.length>=3);
  return [...new Set(terms)];
}
function geographyMatch(series,country,id){
  const text=normalizeText(`${series?.title||''} ${series?.notes||''} ${series?.source||''}`),terms=geographyTerms(country,id);
  return terms.some(term=>text.includes(term));
}

async function fred(path,params={}){
  if(!FRED_API_KEY)throw new Error('FRED_API_KEY is not configured in the private collector');
  const url=new URL(`https://api.stlouisfed.org/fred/${path}`);
  for(const [key,value] of Object.entries({...params,api_key:FRED_API_KEY,file_type:'json'}))if(value!=null)url.searchParams.set(key,String(value));
  const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'FXGA-Economy-Resolver/2.0'}});
  if(!response.ok)throw new Error(`FRED ${path} HTTP ${response.status}`);
  return response.json();
}

async function searchSeries(country,category){
  const payload=await fred('series/search',{search_text:`${country} ${category.query}`,limit:12,order_by:'search_rank'});
  return Array.isArray(payload?.seriess)?payload.seriess:[];
}
async function observations(seriesId){
  const payload=await fred('series/observations',{series_id:seriesId,sort_order:'desc',limit:24});
  return (Array.isArray(payload?.observations)?payload.observations:[]).map(row=>({date:String(row.date||''),value:Number(row.value)})).filter(row=>row.date&&Number.isFinite(row.value)).reverse();
}
function momentum(rows,title,category){
  if(rows.length<2)return 0;
  const values=rows.map(row=>row.value),diffs=[];for(let i=1;i<values.length;i++)diffs.push(values[i]-values[i-1]);
  const scale=Math.max(std(diffs),Math.abs(mean(diffs))*0.5,1e-9),last=diffs.at(-1),raw=clamp((last/scale)*35);
  if(category==='labour'&&/unemployment|jobless|claim/i.test(title))return -raw;
  return raw;
}
function regime(growth,inflation){if(growth>20&&inflation>20)return'inflationary expansion';if(growth>20&&inflation<=20)return'growth expansion';if(growth<-20&&inflation>20)return'stagflation risk';if(growth<-20&&inflation<-20)return'disinflationary slowdown';return'mixed transition';}
function meta(id,label){const known=KNOWN[id];return{currency:known?.[0]||'N/A',centralBank:known?.[1]||`${label} central bank / monetary authority`};}

async function resolveCategory(country,id,category){
  const candidates=(await searchSeries(country,category))
    .filter(series=>series?.id&&geographyMatch(series,country,id))
    .filter(series=>ageDays(series.observation_end)<=freshnessLimitDays(series.frequency))
    .map(series=>({series,rank:60+Math.min(25,Number(series.popularity||0)*.25)+freshnessScore(series.observation_end,series.frequency)*15}))
    .sort((a,b)=>b.rank-a.rank)
    .slice(0,6);
  for(const {series,rank} of candidates){
    const title=String(series.title||series.id||'');
    try{
      const history=await observations(series.id);
      if(history.length<2)continue;
      const latest=history.at(-1),previous=history.at(-2),freshness=freshnessScore(latest.date,series.frequency);
      if(freshness<=0)continue;
      const score=momentum(history,title,category.id),quality=Math.max(0,Math.min(1,.45+.25*Math.min(1,history.length/12)+.30*freshness));
      return{seriesId:String(series.id),title,value:latest.value,date:latest.date,previous:previous.value,change:latest.value-previous.value,units:String(series.units||''),frequency:String(series.frequency||''),categories:[category.id],importance:'high',source:'FRED Economic Data',history,score,quality:Number(quality.toFixed(4)),freshness:Number(freshness.toFixed(4)),discoveryRank:Number(rank.toFixed(2)),geographyVerified:true};
    }catch{}
  }
  return null;
}

export async function resolveEconomyOnDemand(countryInput,{force=false}={}){
  const country=cleanCountry(countryInput);
  if(country.length<2)throw new Error('country must contain at least two characters');
  const id=economyId(country);
  if(!id)throw new Error('country name could not be normalized');
  const ref=dynamicEconomies.doc(id.toLowerCase());
  if(!force){
    const snap=await ref.get();
    if(snap.exists){const cached=snap.data(),age=Date.now()-Date.parse(cached.updatedAt||0);if(Number.isFinite(age)&&age<CACHE_MS&&cached.state)return{...cached.state,cached:true,cacheAgeMs:age};}
  }
  const settled=await Promise.all(CATEGORIES.map(async category=>({category,result:await resolveCategory(country,id,category).catch(()=>null)})));
  const rows=settled.filter(x=>x.result).map(x=>({...x.result,economy:id,economies:[id]}));
  if(rows.length<2)throw new Error(`FRED does not currently provide enough geographically verified ${country} series to build even a partial economy report`);
  const scoreBy=Object.fromEntries(CATEGORIES.map(c=>[c.id,settled.find(x=>x.category.id===c.id)?.result?.score??0]));
  const dimensions=CATEGORIES.map(c=>{const result=settled.find(x=>x.category.id===c.id)?.result;return{id:c.id,label:c.label,score:Math.round(scoreBy[c.id]),coverage:result?1:0,quality:result?.quality??0,freshness:result?.freshness??0,contributors:result?[{seriesId:result.seriesId,title:result.title,score:Math.round(result.score),category:c.id,quality:result.quality,freshness:result.freshness}]:[]};});
  const covered=dimensions.filter(d=>d.coverage>0).length,missingDimensions=dimensions.filter(d=>!d.coverage).map(d=>d.id),reportStatus=covered>=4?'full':covered>=2?'partial':'unavailable';
  const coverageRatio=covered/CATEGORIES.length,averageQuality=mean(rows.map(row=>row.quality||0)),averageFreshness=mean(rows.map(row=>row.freshness||0));
  const currencyScore=clamp(0.27*scoreBy.growth+0.22*scoreBy.labour+0.24*scoreBy.policy+0.12*scoreBy.inflation+0.15*scoreBy.financial),r=regime(scoreBy.growth,scoreBy.inflation),m=meta(id,country),policyStance=scoreBy.policy>20?'hawkish':scoreBy.policy<-20?'dovish':'balanced';
  const rawConfidence=Math.round(20+coverageRatio*45+averageQuality*20+averageFreshness*15),confidence=Math.min(reportStatus==='full'?92:55,rawConfidence);
  const state={id,label:country,currency:m.currency,centralBank:m.centralBank,observationCount:rows.length,confidence,confidenceMeaning:'evidence-quality-score-not-calibrated-probability',coverageRatio:Number(coverageRatio.toFixed(3)),reportStatus,missingDimensions,averageEvidenceQuality:Number(averageQuality.toFixed(3)),averageFreshness:Number(averageFreshness.toFixed(3)),regime:r,policyStance,currencyBias:currencyScore>18?'supportive':currencyScore<-18?'weakening':'mixed',currencyScore:Math.round(currencyScore),dimensions,topSignals:rows.sort((a,b)=>Math.abs(b.score)-Math.abs(a.score)).map(row=>({seriesId:row.seriesId,title:row.title,score:Math.round(row.score),value:row.value,date:row.date,quality:row.quality,freshness:row.freshness})).slice(0,8),summary:`${country}: ${reportStatus==='partial'?'partial evidence; ':''}${r}; ${policyStance} policy impulse; macro score ${Math.round(currencyScore)}.`,resolvedOnDemand:true,source:'FRED on-demand economy resolver',sourcePolicy:'Geography verified; frequency-aware freshness; no synthetic observations.',generatedAt:new Date().toISOString()};
  await ref.set({updatedAt:new Date().toISOString(),country,id,state,observations:rows,resolverVersion:'2.0'},{merge:false});
  return state;
}

export async function listDynamicEconomies(limit=200){const snap=await dynamicEconomies.limit(Math.min(200,Math.max(1,limit))).get();return snap.docs.map(doc=>doc.data()?.state).filter(Boolean);}
