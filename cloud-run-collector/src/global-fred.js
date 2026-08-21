const DAY_MS = 86_400_000;

export const FRED_BASE_IDS = [
  'CPIAUCSL','CPILFESL','PCEPI','PCEPILFE','PPIACO','PPIFIS','T5YIE','T10YIE','T5YIFR',
  'UNRATE','U6RATE','PAYEMS','CIVPART','EMRATIO','ICSA','CCSA','JTSJOL','JTSQUR','CES0500000003',
  'GDPC1','GDP','A191RL1Q225SBEA','INDPRO','IPMAN','CFNAI','TCU',
  'WALCL','WRESBAL','RRPONTSYD','WTREGEN','M2SL','M1SL','BOGMBASE',
  'TOTBKCR','BUSLOANS','CONSUMER','REALLN','BAMLH0A0HYM2','BAMLC0A4CBBB','DRTSCILM',
  'HOUST','PERMIT','HSN1F','EXHOSLUSM495S','CSUSHPINSA','MORTGAGE30US','MSPUS','RRVRUSQ156N',
  'MANEMP','AMTMNO','DGORDER','MCUMFN',
  'FEDFUNDS','DFF','SOFR','IORB','OBFR',
  'DGS1MO','DGS3MO','DGS1','DGS2','DGS5','DGS7','DGS10','DGS20','DGS30','DFII5','DFII10','DFII30',
  'T10Y2Y','T10Y3M','AAA10Y','BAA10Y',
  'USREC','USRECM','SAHMREALTIME','RECPROUSM156N',
  'NFCI','ANFCI','STLFSI4','KCFSI',
  'DTWEXBGS','DTWEXAFEGS','DTWEXEMEGS','DEXUSEU','DEXUSUK','DEXJPUS','DEXCAUS','DEXUSAL','DEXUSNZ','DEXSZUS',
  'VIXCLS','VXNCLS','GVZCLS','OVXCLS',
  'DCOILWTICO','DCOILBRENTEU','SP500','NASDAQCOM','DJIA',
  'PCEC96','PCE','RSAFS','DEXSFUS','DSPIC96','PSAVERT','UMCSENT','BUSINV','ISRATIO',
];

export const FAST_FRED_IDS = new Set([
  'T5YIE','T10YIE','T5YIFR','WALCL','WRESBAL','RRPONTSYD','WTREGEN','TOTBKCR','BUSLOANS',
  'BAMLH0A0HYM2','BAMLC0A4CBBB','FEDFUNDS','DFF','SOFR','IORB','OBFR','DGS1MO','DGS3MO','DGS1','DGS2',
  'DGS5','DGS7','DGS10','DGS20','DGS30','DFII5','DFII10','DFII30','T10Y2Y','T10Y3M','NFCI','ANFCI',
  'STLFSI4','KCFSI','DTWEXBGS','DTWEXAFEGS','DTWEXEMEGS','DEXUSEU','DEXUSUK','DEXJPUS','DEXSFUS','DEXCAUS',
  'DEXUSAL','DEXUSNZ','DEXSZUS','VIXCLS','VXNCLS','GVZCLS','OVXCLS','DCOILWTICO','DCOILBRENTEU',
  'SP500','NASDAQCOM','DJIA','ICSA','CCSA',
]);

export const ECONOMY_LABELS = Object.freeze({
  USA:'United States',EUROPE:'Euro Area',UK:'United Kingdom',SOUTH_AFRICA:'South Africa',JAPAN:'Japan',
  CANADA:'Canada',AUSTRALIA:'Australia',NEW_ZEALAND:'New Zealand',SWITZERLAND:'Switzerland',CHINA:'China',INDIA:'India',BRAZIL:'Brazil',MEXICO:'Mexico',SOUTH_KOREA:'South Korea',INDONESIA:'Indonesia',SAUDI_ARABIA:'Saudi Arabia',TURKEY:'Türkiye',ARGENTINA:'Argentina',SINGAPORE:'Singapore',NORWAY:'Norway',SWEDEN:'Sweden',
});

export const ECONOMY_SEARCHES = {
  USA: [
    ['inflation','United States consumer price index inflation'],['core-inflation','United States core CPI'],
    ['employment','United States employment payrolls'],['unemployment','United States unemployment rate'],
    ['wages','United States average hourly earnings wages'],['growth','United States real GDP'],
    ['industry','United States industrial production'],['retail','United States retail sales'],
    ['housing','United States housing starts'],['producer-prices','United States producer price index'],
    ['money','United States money supply M2'],['confidence','United States consumer sentiment'],
    ['policy-rate','United States Federal Reserve policy interest rate'],['bond-yield','United States 10 year government bond yield'],
    ['trade','United States trade balance'],['current-account','United States current account'],
  ],
  EUROPE: [
    ['inflation','Euro Area harmonised consumer prices HICP'],['core-inflation','Euro Area core inflation HICP'],
    ['employment','Euro Area employment'],['unemployment','Euro Area unemployment rate'],
    ['wages','Euro Area wages compensation employees'],['growth','Euro Area real GDP'],
    ['industry','Euro Area industrial production'],['retail','Euro Area retail sales'],
    ['producer-prices','Euro Area producer prices'],['money','Euro Area M3 money supply'],
    ['policy-rate','European Central Bank policy interest rate'],['bond-yield','Euro Area 10 year government bond yield'],
    ['trade','Euro Area trade balance'],['current-account','Euro Area current account'],
    ['confidence','Euro Area economic sentiment confidence'],['housing','Euro Area house prices'],
  ],
  UK: [
    ['inflation','United Kingdom consumer price index CPI'],['core-inflation','United Kingdom core inflation CPI'],
    ['employment','United Kingdom employment'],['unemployment','United Kingdom unemployment rate'],
    ['wages','United Kingdom average earnings wages'],['growth','United Kingdom real GDP'],
    ['industry','United Kingdom industrial production'],['manufacturing','United Kingdom manufacturing production'],
    ['retail','United Kingdom retail sales'],['producer-prices','United Kingdom producer price index'],
    ['money','United Kingdom M4 money supply'],['policy-rate','Bank of England policy rate bank rate'],
    ['bond-yield','United Kingdom 10 year government bond yield'],['trade','United Kingdom trade balance'],
    ['current-account','United Kingdom current account'],['confidence','United Kingdom consumer confidence'],
  ],
  SOUTH_AFRICA: [
    ['inflation','South Africa consumer price index inflation'],['core-inflation','South Africa core inflation'],
    ['employment','South Africa employment'],['unemployment','South Africa unemployment rate'],
    ['wages','South Africa wages earnings'],['growth','South Africa real GDP'],
    ['industry','South Africa industrial production'],['manufacturing','South Africa manufacturing production'],
    ['mining','South Africa mining production'],['retail','South Africa retail sales'],
    ['producer-prices','South Africa producer price index'],['money','South Africa M3 money supply'],
    ['policy-rate','South Africa repo rate SARB'],['bond-yield','South Africa 10 year government bond yield'],
    ['trade','South Africa trade balance'],['current-account','South Africa current account'],
    ['confidence','South Africa business confidence'],['currency','South African rand exchange rate'],
  ],
  JAPAN: [
    ['inflation','Japan consumer price index CPI'],['core-inflation','Japan core consumer price inflation'],
    ['employment','Japan employment'],['unemployment','Japan unemployment rate'],
    ['wages','Japan wages earnings'],['growth','Japan real GDP'],
    ['industry','Japan industrial production'],['retail','Japan retail sales'],
    ['household-spending','Japan household consumption spending'],['producer-prices','Japan producer price index corporate goods prices'],
    ['money','Japan M2 money stock'],['monetary-base','Japan monetary base'],
    ['policy-rate','Bank of Japan policy interest rate'],['bond-yield','Japan 10 year government bond yield JGB'],
    ['trade','Japan trade balance'],['current-account','Japan current account'],
    ['confidence','Japan consumer confidence'],['business-confidence','Japan Tankan business conditions'],
  ],
};

const EXTENDED_SEARCH_LANES = Object.freeze([
  ['inflation','consumer price inflation CPI'],
  ['core-inflation','core consumer price inflation'],
  ['employment','employment labour market'],
  ['unemployment','unemployment rate'],
  ['wages','wages earnings compensation'],
  ['growth','real GDP economic growth'],
  ['industry','industrial production manufacturing'],
  ['retail','retail sales household consumption'],
  ['policy-rate','central bank policy interest rate'],
  ['bond-yield','10 year government bond yield'],
  ['trade','trade balance exports imports'],
  ['current-account','current account balance'],
]);
for (const [economy,label] of Object.entries(ECONOMY_LABELS)) {
  if (ECONOMY_SEARCHES[economy]) continue;
  ECONOMY_SEARCHES[economy] = EXTENDED_SEARCH_LANES.map(([category,query])=>[category,`${label} ${query}`]);
}

const ECONOMY_TERMS = {
  USA:/united states|u\.s\.|usa|federal reserve/i,
  EUROPE:/euro area|eurozone|european central bank|european union/i,
  UK:/united kingdom|u\.k\.|britain|bank of england/i,
  SOUTH_AFRICA:/south africa|sarb|south african/i,
  JAPAN:/japan|bank of japan|japanese/i,
  SOUTH_KOREA:/south korea|republic of korea|korean/i,
  TURKEY:/turkey|türkiye|turkiye/i,
};
for (const [economy,label] of Object.entries(ECONOMY_LABELS)) {
  if (!ECONOMY_TERMS[economy]) ECONOMY_TERMS[economy]=new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');
}
const ORIGINAL_DEEP = new Set(['USA','EUROPE','UK','SOUTH_AFRICA','JAPAN']);
const ECONOMY_MINIMUM = Object.fromEntries(Object.keys(ECONOMY_SEARCHES).map(economy=>[economy,economy==='USA'?12:ORIGINAL_DEEP.has(economy)?14:8]));

function freshnessLimitDays(frequency='') {
  const f=String(frequency).toLowerCase();
  if(/daily/.test(f))return 30;
  if(/weekly/.test(f))return 75;
  if(/monthly/.test(f))return 150;
  if(/quarter/.test(f))return 400;
  if(/annual/.test(f))return 800;
  return 240;
}
function ageDays(value) {
  const end=Date.parse(value||'');
  return Number.isFinite(end)?Math.max(0,(Date.now()-end)/DAY_MS):Infinity;
}
function freshnessScore(series) {
  const limit=freshnessLimitDays(series.frequency),age=ageDays(series.observation_end);
  if(!Number.isFinite(age)||age>limit)return 0;
  return Math.max(0,Math.min(1,1-age/Math.max(1,limit)));
}
function recentEnough(series) {
  return freshnessScore(series)>0;
}
function usefulFrequency(series) {
  const frequency=String(series.frequency||'').toLowerCase();
  return !/(annual|semiannual|5-year|10-year)/.test(frequency);
}
function geographyMatch(series,economy) {
  const text=`${series.title||''} ${series.notes||''} ${series.source||''}`;
  return Boolean(ECONOMY_TERMS[economy]?.test(text));
}
function scoreSeries(series,economy,category) {
  const title=String(series.title||'').toLowerCase(),text=`${series.title||''} ${series.notes||''}`;
  const geography=ECONOMY_TERMS[economy]?.test(text)?60:-80;
  const frequency=String(series.frequency||'').toLowerCase();
  const frequencyBonus=/daily|weekly/.test(frequency)?14:/monthly/.test(frequency)?13:/quarterly/.test(frequency)?9:0;
  const freshness=freshnessScore(series)*18;
  const popularity=Math.min(Math.max(Number(series.popularity||0),0),100)*.25;
  const tokens=category.replace(/-/g,' ').split(/\s+/).filter(Boolean),categoryMatch=tokens.some(token=>title.includes(token))?10:0;
  const seasonal=/seasonally adjusted/i.test(String(series.seasonal_adjustment||''))?3:0;
  return geography+frequencyBonus+freshness+popularity+categoryMatch+seasonal;
}

export async function discoverGlobalFredUniverse(apiKey,fetchJson,options={}) {
  if (!apiKey) throw new Error('FRED API key is required for global discovery');
  const maxSeries=Math.min(Math.max(Number(options.maxSeries||320),220),420);
  const maxPerQuery=Math.min(Math.max(Number(options.maxPerQuery||3),1),4);
  const curated=FRED_BASE_IDS.map((seriesId)=>({seriesId,economy:seriesId==='DEXSFUS'?'SOUTH_AFRICA':'USA',category:'fxga-core',source:'FRED curated core',curated:true,geographyVerified:true,qualityTier:'curated'}));
  const discoveredByEconomy=Object.fromEntries(Object.keys(ECONOMY_SEARCHES).map((economy)=>[economy,new Map()]));
  const diagnostics={queries:0,providerFailures:0,rejectedGeography:0,rejectedFreshness:0,rejectedFrequency:0,candidatesAccepted:0};

  for (const [economy,searches] of Object.entries(ECONOMY_SEARCHES)) {
    for (const [category,searchText] of searches) {
      diagnostics.queries++;
      const url=new URL('https://api.stlouisfed.org/fred/series/search');
      url.searchParams.set('api_key',apiKey);url.searchParams.set('file_type','json');
      url.searchParams.set('search_text',searchText);url.searchParams.set('limit','20');url.searchParams.set('order_by','search_rank');
      const payload=await fetchJson(url,8000).catch(()=>{diagnostics.providerFailures++;return null;});
      const raw=Array.isArray(payload?.seriess)?payload.seriess:[];
      const candidates=[];
      for(const series of raw){
        if(!series?.id)continue;
        if(!geographyMatch(series,economy)){diagnostics.rejectedGeography++;continue;}
        if(!usefulFrequency(series)){diagnostics.rejectedFrequency++;continue;}
        if(!recentEnough(series)){diagnostics.rejectedFreshness++;continue;}
        const score=scoreSeries(series,economy,category);
        candidates.push({series,score});
      }
      candidates.sort((a,b)=>b.score-a.score);
      for (const {series,score} of candidates.slice(0,maxPerQuery)) {
        if (FRED_BASE_IDS.includes(series.id)) continue;
        const descriptor={seriesId:series.id,title:series.title,units:series.units_short||series.units||'',frequency:series.frequency||'',seasonalAdjustment:series.seasonal_adjustment||'',observationEnd:series.observation_end||'',lastUpdated:series.last_updated||'',economy,category,popularity:Number(series.popularity||0),freshnessScore:Number(freshnessScore(series).toFixed(4)),discoveryScore:Number(score.toFixed(2)),source:'FRED dynamic economy discovery',curated:false,geographyVerified:true,qualityTier:score>=90?'high':score>=75?'medium':'low'};
        const current=discoveredByEconomy[economy].get(series.id);
        if (!current||score>Number(current.discoveryScore||0)) discoveredByEconomy[economy].set(series.id,descriptor);
        diagnostics.candidatesAccepted++;
      }
    }
  }

  const selected=[];const selectedIds=new Set(FRED_BASE_IDS);
  const coverageByEconomy={};
  for (const economy of Object.keys(ECONOMY_SEARCHES)) {
    const ranked=[...discoveredByEconomy[economy].values()].sort((a,b)=>Number(b.discoveryScore||0)-Number(a.discoveryScore||0));
    const chosen=[];
    for (const item of ranked) {
      if(chosen.length>=Number(ECONOMY_MINIMUM[economy]||8))break;
      if (!selectedIds.has(item.seriesId)){selected.push(item);chosen.push(item);selectedIds.add(item.seriesId);}
    }
    coverageByEconomy[economy]={available:ranked.length,selected:chosen.length,minimum:Number(ECONOMY_MINIMUM[economy]||8),status:chosen.length>=Number(ECONOMY_MINIMUM[economy]||8)?'target-met':chosen.length>=5?'partial':'insufficient'};
  }
  const remainder=[];
  for (const economy of Object.keys(ECONOMY_SEARCHES)) {
    for (const item of discoveredByEconomy[economy].values()) if (!selectedIds.has(item.seriesId)) remainder.push(item);
  }
  remainder.sort((a,b)=>Number(b.discoveryScore||0)-Number(a.discoveryScore||0));
  for (const item of remainder) {
    if (curated.length+selected.length>=maxSeries) break;
    if (!selectedIds.has(item.seriesId)){selected.push(item);selectedIds.add(item.seriesId);}
  }
  const result=[...curated,...selected].slice(0,maxSeries);
  Object.defineProperty(result,'discoveryDiagnostics',{value:{...diagnostics,coverageByEconomy,maxSeries,selected:result.length},enumerable:false});
  return result;
}

export function summarizeUniverse(universe) {
  const byEconomy={},byCategory={},freshness={high:0,medium:0,low:0,curated:0};
  for (const item of universe) {
    byEconomy[item.economy||'UNKNOWN']=(byEconomy[item.economy||'UNKNOWN']||0)+1;
    byCategory[item.category||'other']=(byCategory[item.category||'other']||0)+1;
    freshness[item.qualityTier||'low']=(freshness[item.qualityTier||'low']||0)+1;
  }
  const economyCoverage=Object.fromEntries(Object.keys(ECONOMY_SEARCHES).map(id=>[id,{series:Number(byEconomy[id]||0),minimum:Number(ECONOMY_MINIMUM[id]||8),status:Number(byEconomy[id]||0)>=Number(ECONOMY_MINIMUM[id]||8)?'target-met':Number(byEconomy[id]||0)>=5?'partial':'insufficient'}]));
  return {total:universe.length,curatedBase:FRED_BASE_IDS.length,byEconomy,byCategory,economyMinimums:ECONOMY_MINIMUM,economyCoverage,qualityTiers:freshness,policy:{frequencyAwareFreshness:true,geographyVerification:true,annualSeriesExcludedFromCurrentState:true,syntheticObservations:false}};
}
