import crypto from 'node:crypto';

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const mean=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
const variance=(xs)=>xs.length>1?xs.reduce((s,x)=>s+(x-mean(xs))**2,0)/(xs.length-1):0;
const stdev=(xs)=>Math.sqrt(Math.max(0,variance(xs)));
const median=(xs)=>{if(!xs.length)return 0;const a=[...xs].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
const mad=(xs)=>{if(!xs.length)return 0;const m=median(xs);return median(xs.map(x=>Math.abs(x-m)));};
const sigmoid=(x)=>1/(1+Math.exp(-x));
const num=(v)=>{if(typeof v==='number'&&Number.isFinite(v))return v;if(v==null)return null;const n=Number(String(v).replace(/,/g,'').replace(/%/g,'').trim());return Number.isFinite(n)?n:null;};
const hash=(v)=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const iso=()=>new Date().toISOString();
const ageMinutes=(v)=>{const t=Date.parse(v||'');return Number.isFinite(t)?Math.max(0,Math.round((Date.now()-t)/60000)):null;};
const pct=(n,d)=>d?100*n/d:0;

function zscore(value,values){
  const clean=values.filter(Number.isFinite);
  if(clean.length<3||!Number.isFinite(value))return 0;
  const sd=stdev(clean);
  return sd>1e-12?(value-mean(clean))/sd:0;
}
function robustZ(value,values){
  const clean=values.filter(Number.isFinite);
  if(clean.length<4||!Number.isFinite(value))return 0;
  const m=median(clean),scale=mad(clean)*1.4826;
  return scale>1e-12?(value-m)/scale:0;
}
function normalizeText(value=''){return String(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function macroFamily(item){
  const t=normalizeText(`${item?.categories?.join?.(' ')||''} ${item?.title||''} ${item?.seriesId||''}`);
  if(/inflation|cpi|pce|ppi|price|deflator|breakeven/.test(t))return'inflation';
  if(/employment|unemployment|payroll|claims|labou?r|wage|earnings/.test(t))return'labour';
  if(/gdp|growth|retail|industrial|production|pmi|orders|housing|confidence|activity/.test(t))return'growth';
  if(/rate|yield|treasury|curve|spread|financial condition|credit|liquidity|money/.test(t))return'rates-credit';
  if(/trade|current account|export|import|balance/.test(t))return'external';
  if(/fiscal|budget|debt|deficit/.test(t))return'fiscal';
  return'other';
}
function eventFamily(event){
  const t=normalizeText(`${event?.event||''} ${event?.category||''}`);
  if(/cpi|pce|ppi|inflation|price|deflator/.test(t))return'inflation';
  if(/payroll|employment|unemployment|jobless|claims|jolts|wage|earnings/.test(t))return'employment';
  if(/interest rate|rate decision|central bank|fomc|ecb|boe|boj|sarb|monetary/.test(t))return'policy';
  if(/gdp/.test(t))return'gdp';
  if(/retail/.test(t))return'retail-sales';
  if(/pmi|confidence|sentiment|business activity/.test(t))return'surveys';
  if(/trade|current account|export|import/.test(t))return'external';
  if(/budget|fiscal/.test(t))return'fiscal';
  if(/housing|building permit|home sale|construction/.test(t))return'housing';
  return'other';
}
function quoteClass(asset){
  const t=normalizeText(`${asset?.assetClass||''} ${asset?.label||''} ${asset?.symbol||''}`);
  if(/forex|currency|fx/.test(t))return'fx';
  if(/gold|silver|copper|oil|crude|brent|natural gas|commodity/.test(t))return'commodity';
  if(/yield|treasury|bond|rate/.test(t))return'rates';
  if(/index|s p|nasdaq|dow|dax|ftse|nikkei|equity/.test(t))return'equity';
  if(/bitcoin|ethereum|crypto/.test(t))return'crypto';
  return'other';
}

function validateObservation(item){
  const issues=[];
  if(!item?.seriesId)issues.push('missing-series-id');
  if(!item?.title)issues.push('missing-title');
  if(!Number.isFinite(num(item?.value)))issues.push('missing-numeric-value');
  if(!item?.date)issues.push('missing-observation-date');
  if(!item?.source)issues.push('missing-source');
  const history=Array.isArray(item?.history)?item.history:[];
  if(history.length<2)issues.push('limited-history');
  return issues;
}
function buildDataQuality({observations=[],events=[],market=[],news=[]}){
  const observationChecks=observations.map(item=>({id:item.seriesId,issues:validateObservation(item)}));
  const missing=observationChecks.filter(x=>x.issues.some(i=>i.startsWith('missing-'))).length;
  const limited=observationChecks.filter(x=>x.issues.includes('limited-history')).length;
  const stale=observations.filter(item=>{
    const a=ageMinutes(item?.collectedAt||item?.lastUpdated||item?.date);
    return a!=null&&a>7*24*60;
  }).length;
  const outliers=[];
  for(const item of observations){
    const history=(item?.history||[]).map(x=>num(x?.value)).filter(Number.isFinite);
    const value=num(item?.value);
    const rz=robustZ(value,history);
    if(Math.abs(rz)>=5)outliers.push({id:item.seriesId,robustZ:Number(rz.toFixed(2)),value});
  }
  const calendarInvalid=events.filter(e=>!e?.id||!e?.date||!e?.event).length;
  const marketInvalid=market.filter(a=>!a?.id||!Number.isFinite(num(a?.price))).length;
  const newsInvalid=news.filter(n=>!n?.id||!n?.title).length;
  const coverageScore=clamp(Math.round(100*(1-(missing+calendarInvalid+marketInvalid+newsInvalid)/Math.max(1,observations.length+events.length+market.length+news.length))),0,100);
  const historyScore=clamp(Math.round(100*(1-limited/Math.max(1,observations.length))),0,100);
  const freshnessScore=clamp(Math.round(100*(1-stale/Math.max(1,observations.length))),0,100);
  const anomalyScore=clamp(Math.round(100*(1-outliers.length/Math.max(1,observations.length))),0,100);
  const overall=Math.round(.35*coverageScore+.25*historyScore+.25*freshnessScore+.15*anomalyScore);
  const severity=overall>=90?'healthy':overall>=75?'watch':'degraded';
  return {
    generatedAt:iso(),overall,severity,
    scores:{coverage:coverageScore,history:historyScore,freshness:freshnessScore,anomaly:anomalyScore},
    diagnostics:{macroObservations:observations.length,calendarEvents:events.length,marketAssets:market.length,newsItems:news.length,missing,limitedHistory:limited,stale,outliers:outliers.length,calendarInvalid,marketInvalid,newsInvalid},
    outliers:outliers.slice(0,40),
    quarantineCandidates:outliers.filter(x=>Math.abs(x.robustZ)>=7).slice(0,30),
  };
}

function buildSourceReliability(observations=[]){
  const groups=new Map();
  for(const item of observations){const source=String(item?.source||'Unknown');const arr=groups.get(source)||[];arr.push(item);groups.set(source,arr);}
  return [...groups.entries()].map(([source,items])=>{
    const numericCoverage=items.filter(item=>Number.isFinite(num(item?.value))).length/Math.max(1,items.length);
    const freshness=mean(items.map(item=>{const age=ageMinutes(item?.collectedAt||item?.lastUpdated||item?.date);if(age==null)return .25;const halfLife=String(item?.frequency||'').toLowerCase().includes('daily')?7*24*60:String(item?.frequency||'').toLowerCase().includes('weekly')?28*24*60:75*24*60;return Math.max(.05,Math.exp(-Math.log(2)*age/halfLife));}));
    const historyDepth=mean(items.map(item=>Math.min(1,(Array.isArray(item?.history)?item.history.length:0)/12)));
    const anomalyRate=items.filter(item=>{const values=(item?.history||[]).map(x=>num(x?.value)).filter(Number.isFinite),value=num(item?.value);return values.length>=4&&Math.abs(robustZ(value,values))>=5;}).length/Math.max(1,items.length);
    const score=Math.round(100*clamp(.36*numericCoverage+.30*freshness+.24*historyDepth+.10*(1-anomalyRate),0,1));
    return {source,series:items.length,score,status:score>=85?'preferred':score>=65?'accepted':'watch',numericCoverage:Number(numericCoverage.toFixed(4)),freshness:Number(freshness.toFixed(4)),historyDepth:Number(historyDepth.toFixed(4)),anomalyRate:Number(anomalyRate.toFixed(4))};
  }).sort((a,b)=>b.score-a.score);
}

function buildFeatures(observations=[]){
  const features=[];
  for(const item of observations){
    const history=(item?.history||[]).map(x=>({date:x?.date,value:num(x?.value)})).filter(x=>Number.isFinite(x.value));
    const values=history.map(x=>x.value);
    const latest=num(item?.value)??values.at(-1);
    const previous=num(item?.previous)??values.at(-2);
    if(!Number.isFinite(latest))continue;
    const momentum=Number.isFinite(previous)?latest-previous:0;
    const changePct=Number.isFinite(previous)&&Math.abs(previous)>1e-12?100*momentum/Math.abs(previous):0;
    const z=zscore(latest,values),rz=robustZ(latest,values);
    const short=values.slice(-4),long=values.slice(-12);
    const shortMean=mean(short),longMean=mean(long);
    features.push({
      seriesId:item.seriesId,title:item.title,economy:item.economy||item.economies?.[0]||'GLOBAL',family:macroFamily(item),
      value:latest,previous:Number.isFinite(previous)?previous:null,momentum,changePct,zScore:z,robustZ:rz,
      shortMean,longMean,trend:shortMean>longMean?'rising':shortMean<longMean?'falling':'flat',
      volatility:stdev(values.slice(-12)),sampleSize:values.length,
      freshnessMinutes:ageMinutes(item?.collectedAt||item?.lastUpdated||item?.date),
    });
  }
  return features;
}

function ar1Forecast(values){
  const xs=values.filter(Number.isFinite);
  if(xs.length<4)return null;
  const x=xs.slice(0,-1),y=xs.slice(1),mx=mean(x),my=mean(y);
  const denom=x.reduce((s,v)=>s+(v-mx)**2,0);
  const phi=denom>1e-12?x.reduce((s,v,i)=>s+(v-mx)*(y[i]-my),0)/denom:0;
  const intercept=my-phi*mx;
  return intercept+phi*xs.at(-1);
}
function etsForecast(values,alpha=.35){
  const xs=values.filter(Number.isFinite);if(!xs.length)return null;
  let level=xs[0];for(const v of xs.slice(1))level=alpha*v+(1-alpha)*level;return level;
}
function kalmanForecast(values){
  const xs=values.filter(Number.isFinite);if(!xs.length)return null;
  let estimate=xs[0],p=1,q=.01,r=Math.max(1e-8,variance(xs)||1);
  for(const z of xs.slice(1)){p+=q;const k=p/(p+r);estimate+=k*(z-estimate);p=(1-k)*p;}
  return estimate;
}
function modelSet(values){return {AR1:ar1Forecast(values),ETS:etsForecast(values),StateSpace:kalmanForecast(values)};}
function walkForwardCalibration(values,maxPoints=12){
  const names=['AR1','ETS','StateSpace'],errors=Object.fromEntries(names.map(n=>[n,[]]));
  const start=Math.max(4,values.length-Math.max(4,maxPoints));
  for(let i=start;i<values.length;i++){
    const train=values.slice(0,i),actual=values[i],predictions=modelSet(train);
    for(const name of names){const prediction=predictions[name];if(Number.isFinite(prediction))errors[name].push(prediction-actual);}
  }
  const rmse=Object.fromEntries(names.map(name=>{const xs=errors[name];return [name,xs.length?Math.sqrt(mean(xs.map(e=>e*e))):null];}));
  const bias=Object.fromEntries(names.map(name=>{const xs=errors[name];return [name,xs.length?mean(xs):null];}));
  const recentRmse=Object.fromEntries(names.map(name=>{const xs=errors[name],recent=xs.slice(-Math.max(2,Math.ceil(xs.length/2)));return [name,recent.length?Math.sqrt(mean(recent.map(e=>e*e))):null];}));
  const earlierRmse=Object.fromEntries(names.map(name=>{const xs=errors[name],earlier=xs.slice(0,Math.max(0,xs.length-Math.max(2,Math.ceil(xs.length/2))));return [name,earlier.length?Math.sqrt(mean(earlier.map(e=>e*e))):null];}));
  const driftRatio=Object.fromEntries(names.map(name=>{const r=recentRmse[name],e=earlierRmse[name];return [name,Number.isFinite(r)&&Number.isFinite(e)&&e>1e-12?r/e:null];}));
  const finite=names.filter(name=>Number.isFinite(rmse[name]));
  const scale=Math.max(1e-9,stdev(values.slice(-12))||Math.abs(mean(values.slice(-6))) *.01||1);
  const rawWeights=Object.fromEntries(names.map(name=>[name,finite.includes(name)?1/(scale*scale+rmse[name]*rmse[name]):0]));
  const total=Object.values(rawWeights).reduce((s,x)=>s+x,0)||1;
  const weights=Object.fromEntries(names.map(name=>[name,rawWeights[name]/total]));
  const validationPoints=Math.max(...names.map(name=>errors[name].length),0);
  return {validationPoints,rmse,bias,recentRmse,earlierRmse,driftRatio,weights};
}
function buildForecasts(observations=[]){
  const forecasts=[];
  for(const item of observations){
    const values=(item?.history||[]).map(x=>num(x?.value)).filter(Number.isFinite);
    if(values.length<4)continue;
    const current=modelSet(values),models=Object.entries(current).filter(([,v])=>Number.isFinite(v));
    if(!models.length)continue;
    const calibration=walkForwardCalibration(values),available=models.filter(([name])=>Number(calibration.weights[name])>0);
    const weightTotal=available.reduce((s,[name])=>s+Number(calibration.weights[name]||0),0)||1;
    const ensemble=available.length?available.reduce((s,[name,value])=>s+value*Number(calibration.weights[name]||0),0)/weightTotal:mean(models.map(([,v])=>v));
    const residualScale=Math.max(1e-9,stdev(values.slice(-12)));
    const predictionValues=models.map(([,v])=>v),modelDispersion=stdev(predictionValues),agreement=clamp(1-modelDispersion/Math.max(residualScale,1e-9),0,1);
    const validationSufficiency=clamp(calibration.validationPoints/10,0,1),calibrationConfidence=agreement*(.4+.6*validationSufficiency);
    const weightedDrift=Object.entries(calibration.weights).reduce((s,[name,w])=>s+Number(w||0)*Math.max(0,Number(calibration.driftRatio[name]??1)-1),0);
    const driftScore=Math.round(100*clamp(weightedDrift/1.25,0,1)),driftStatus=driftScore>=65?'drifting':driftScore>=35?'watch':'stable';
    const weightedBias=Object.entries(calibration.weights).reduce((s,[name,w])=>s+Number(w||0)*Number(calibration.bias[name]||0),0);
    const driftPenalty=clamp(1-driftScore/180,.55,1),effectiveCalibrationConfidence=calibrationConfidence*driftPenalty;
    const uncertainty=Math.sqrt(residualScale*residualScale+modelDispersion*modelDispersion+(weightedBias*weightedBias));
    const last=values.at(-1),delta=ensemble-last;
    const probabilityUp=sigmoid(delta/Math.max(uncertainty,1e-9)*(1+.75*effectiveCalibrationConfidence));
    forecasts.push({
      seriesId:item.seriesId,title:item.title,economy:item.economy||item.economies?.[0]||'GLOBAL',family:macroFamily(item),
      latest:last,forecast:ensemble,delta,models:Object.fromEntries(models),
      modelWeights:calibration.weights,walkForwardRmse:calibration.rmse,walkForwardBias:calibration.bias,recentRmse:calibration.recentRmse,earlierRmse:calibration.earlierRmse,driftRatio:calibration.driftRatio,validationPoints:calibration.validationPoints,
      modelAgreement:Number(agreement.toFixed(4)),calibrationConfidence:Number(effectiveCalibrationConfidence.toFixed(4)),rawCalibrationConfidence:Number(calibrationConfidence.toFixed(4)),driftScore,driftStatus,forecastBias:weightedBias,
      interval80:[ensemble-1.2816*uncertainty,ensemble+1.2816*uncertainty],
      interval95:[ensemble-1.96*uncertainty,ensemble+1.96*uncertainty],
      probabilities:{up:probabilityUp,down:1-probabilityUp},
      uncertainty,innovationScale:residualScale,modelDispersion,sampleSize:values.length,
      methodology:'Walk-forward inverse-error weighting across AR1, exponential smoothing and state-space forecasts; uncertainty combines historical innovation scale and model disagreement.',
    });
  }
  return forecasts.slice(0,180);
}

function buildModelHealth(forecasts=[]){
  const calibrated=forecasts.filter(f=>Number(f?.validationPoints||0)>0);
  if(!calibrated.length)return {score:0,status:'insufficient',calibratedForecasts:0,totalForecasts:forecasts.length,averageCalibrationConfidence:0,averageDriftScore:0,drifting:0,watch:0,stable:0};
  const avgCalibration=mean(calibrated.map(f=>Number(f.calibrationConfidence||0))),avgDrift=mean(calibrated.map(f=>Number(f.driftScore||0))),validationCoverage=calibrated.length/Math.max(1,forecasts.length),score=Math.round(100*clamp(.50*avgCalibration+.30*(1-avgDrift/100)+.20*validationCoverage,0,1));
  return {score,status:score>=78?'healthy':score>=58?'watch':'degraded',calibratedForecasts:calibrated.length,totalForecasts:forecasts.length,validationCoverage:Number(validationCoverage.toFixed(4)),averageCalibrationConfidence:Number(avgCalibration.toFixed(4)),averageDriftScore:Math.round(avgDrift),drifting:calibrated.filter(f=>f.driftStatus==='drifting').length,watch:calibrated.filter(f=>f.driftStatus==='watch').length,stable:calibrated.filter(f=>f.driftStatus==='stable').length,highestDrift:[...calibrated].sort((a,b)=>Number(b.driftScore||0)-Number(a.driftScore||0)).slice(0,12).map(f=>({seriesId:f.seriesId,title:f.title,driftScore:f.driftScore,driftStatus:f.driftStatus,calibrationConfidence:f.calibrationConfidence,forecastBias:f.forecastBias}))};
}

function buildReleaseAnalytics(events=[]){
  const completed=events.filter(e=>num(e?.actual)!=null&&(num(e?.forecast)!=null||num(e?.previous)!=null));
  const raw=completed.map(e=>{
    const actual=num(e.actual),forecast=num(e.forecast),previous=num(e.revised??e.previous);
    const ref=forecast??previous;
    const surprise=actual-ref;
    const scale=Math.max(Math.abs(ref)*.01,1e-6);
    return {
      id:e.id,date:e.date,event:e.event,currency:e.currency,family:eventFamily(e),importance:Number(e.importance||1),
      actual,forecast,previous,reference:ref,surprise,rawZ:surprise/scale,bias:e.currencyBias||'neutral',biasConfidence:Number(e.biasConfidence||0),
    };
  });
  const familyValues=new Map();
  for(const row of raw){const key=`${row.currency||'NA'}:${row.family}`;const arr=familyValues.get(key)||[];arr.push(row.surprise);familyValues.set(key,arr);}
  const enriched=raw.map(row=>{
    const xs=familyValues.get(`${row.currency||'NA'}:${row.family}`)||[];
    const standardized=xs.length>=3?zscore(row.surprise,xs):clamp(row.rawZ,-5,5);
    const weighted=standardized*(.6+.2*row.importance);
    return {...row,standardizedSurprise:standardized,importanceWeightedSurprise:weighted};
  });
  const groups={};
  for(const row of enriched){
    const key=`${row.currency||'NA'}:${row.family}`;
    const g=groups[key]||{currency:row.currency,family:row.family,count:0,bullish:0,bearish:0,neutral:0,meanAbsSurprise:0,weighted:[]};
    g.count++;g[row.bias]=(g[row.bias]||0)+1;g.meanAbsSurprise+=Math.abs(row.standardizedSurprise);g.weighted.push(row.importanceWeightedSurprise);groups[key]=g;
  }
  const profiles=Object.values(groups).map(g=>({
    currency:g.currency,family:g.family,count:g.count,bullish:g.bullish||0,bearish:g.bearish||0,neutral:g.neutral||0,
    bullishRate:pct(g.bullish||0,g.count),bearishRate:pct(g.bearish||0,g.count),
    meanAbsSurprise:g.meanAbsSurprise/Math.max(1,g.count),meanWeightedSurprise:mean(g.weighted),
  })).sort((a,b)=>b.count-a.count);
  return {generatedAt:iso(),completed:enriched.length,events:enriched.slice(-250),profiles};
}

function buildMarketAnalytics(market=[]){
  const valid=market.filter(a=>Number.isFinite(num(a?.price)));
  const groups={};
  for(const a of valid){const k=quoteClass(a);(groups[k]??=[]).push(a);}
  const breadth=Object.fromEntries(Object.entries(groups).map(([k,arr])=>{
    const changes=arr.map(a=>num(a?.changePercent??a?.changePct??a?.percentChange)).filter(Number.isFinite);
    return [k,{assets:arr.length,advancing:changes.filter(x=>x>0).length,declining:changes.filter(x=>x<0).length,flat:changes.filter(x=>x===0).length,averageChangePercent:changes.length?mean(changes):null}];
  }));
  return {generatedAt:iso(),assets:valid.length,stale:valid.filter(a=>a?.stale).length,breadth};
}

function scoreCurrencyFromState(state){
  if(!state)return 0;
  return Number(state.score??state.compositeScore??0)||0;
}
const SCENARIOS=[
  {id:'hotter-inflation',label:'Hotter inflation',currency:{USD:12,EUR:10,GBP:10,JPY:5,ZAR:-3,CAD:4,AUD:2,NZD:2,CHF:5,CNY:-2},assets:{gold:-8,equity:-10,rates:12,crypto:-12,commodity:3},confidence:-6},
  {id:'weaker-growth',label:'Weaker growth',currency:{USD:5,EUR:-7,GBP:-7,JPY:7,ZAR:-12,CAD:-8,AUD:-10,NZD:-10,CHF:8,CNY:-9},assets:{gold:8,equity:-14,rates:-10,crypto:-12,commodity:-14},confidence:-8},
  {id:'hawkish-policy',label:'Hawkish central bank',currency:{USD:14,EUR:12,GBP:12,JPY:10,ZAR:9,CAD:10,AUD:10,NZD:10,CHF:8,CNY:5},assets:{gold:-10,equity:-10,rates:14,crypto:-14,commodity:-3},confidence:-4},
  {id:'dovish-policy',label:'Dovish central bank',currency:{USD:-12,EUR:-10,GBP:-10,JPY:-9,ZAR:-8,CAD:-9,AUD:-9,NZD:-9,CHF:-7,CNY:-5},assets:{gold:10,equity:12,rates:-12,crypto:13,commodity:4},confidence:-3},
  {id:'oil-spike',label:'Oil price spike',currency:{USD:2,EUR:-7,GBP:-4,JPY:-10,ZAR:5,CAD:11,AUD:3,NZD:-3,CHF:-2,CNY:-5},assets:{gold:5,equity:-6,rates:5,crypto:-3,commodity:16},confidence:-5},
  {id:'risk-off',label:'Risk-off shock',currency:{USD:10,EUR:-5,GBP:-7,JPY:13,ZAR:-18,CAD:-8,AUD:-14,NZD:-14,CHF:12,CNY:-8},assets:{gold:12,equity:-20,rates:-8,crypto:-22,commodity:-12},confidence:-10},
  {id:'curve-steepening',label:'Yield-curve steepening',currency:{USD:7,EUR:3,GBP:3,JPY:-2,ZAR:-2,CAD:2,AUD:1,NZD:1,CHF:1,CNY:-2},assets:{gold:-3,equity:4,rates:8,crypto:1,commodity:4},confidence:-3},
  {id:'curve-inversion',label:'Yield-curve inversion',currency:{USD:5,EUR:-3,GBP:-4,JPY:6,ZAR:-10,CAD:-5,AUD:-7,NZD:-7,CHF:6,CNY:-6},assets:{gold:8,equity:-14,rates:-9,crypto:-10,commodity:-9},confidence:-7},
  {id:'fiscal-expansion',label:'Fiscal expansion',currency:{USD:6,EUR:5,GBP:5,JPY:1,ZAR:4,CAD:3,AUD:3,NZD:3,CHF:1,CNY:5},assets:{gold:3,equity:8,rates:8,crypto:5,commodity:7},confidence:-4},
  {id:'geopolitical-escalation',label:'Geopolitical escalation',currency:{USD:11,EUR:-8,GBP:-6,JPY:10,ZAR:-15,CAD:-4,AUD:-8,NZD:-9,CHF:13,CNY:-8},assets:{gold:17,equity:-18,rates:-5,crypto:-16,commodity:10},confidence:-12},
];
function buildScenarios(currencyStates=[],opportunities=[]){
  const baseline=Object.fromEntries(currencyStates.map(s=>[s.currency,scoreCurrencyFromState(s)]));
  const pairUniverse=opportunities.map(o=>o.symbol).filter(s=>/^[A-Z]{6}$/.test(s));
  return SCENARIOS.map(s=>{
    const currencies=Object.fromEntries(Object.entries(baseline).map(([ccy,score])=>[ccy,clamp(score+(s.currency[ccy]||0),-100,100)]));
    const pairs=pairUniverse.map(symbol=>{
      const base=symbol.slice(0,3),quote=symbol.slice(3),score=Math.round((currencies[base]??baseline[base]??0)-(currencies[quote]??baseline[quote]??0));
      return {symbol,score,direction:score>=18?'BUY':score<=-18?'SELL':'WAIT'};
    }).sort((a,b)=>Math.abs(b.score)-Math.abs(a.score));
    return {...s,currencies,pairs,confidenceChange:s.confidence,comparisonHash:hash({id:s.id,currencies,pairs}).slice(0,16)};
  });
}

function buildRisk({dataQuality,marketAnalytics,events=[],currencyStates=[],opportunities=[],releaseAnalytics}){
  const now=Date.now();
  const nextHigh=events.filter(e=>Number(e.importance||1)>=3&&Date.parse(e.date)>=now).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))[0];
  const mins=nextHigh?Math.round((Date.parse(nextHigh.date)-now)/60000):null;
  const eventGap=mins==null?20:mins<=15?95:mins<=60?75:mins<=180?55:30;
  const marketMissing=marketAnalytics.assets?clamp(100*(marketAnalytics.stale/marketAnalytics.assets),0,100):65;
  const contradiction=opportunities.length?mean(opportunities.map(o=>Array.isArray(o?.criticalThinking?.contradictions)?Math.min(100,o.criticalThinking.contradictions.length*22):0)):20;
  const confidenceMean=currencyStates.length?mean(currencyStates.map(x=>Number(x.confidence||0))):50;
  const releaseVol=releaseAnalytics.events.length?clamp(mean(releaseAnalytics.events.slice(-20).map(x=>Math.min(100,Math.abs(x.standardizedSurprise)*22))),0,100):30;
  const categories=[
    ['volatility',clamp(releaseVol+10,0,100)],
    ['event-gap',eventGap],
    ['liquidity',marketMissing],
    ['correlation',marketAnalytics.assets<5?70:30],
    ['crowding',35],
    ['macro-contradiction',contradiction],
    ['policy-surprise',releaseAnalytics.events.filter(x=>x.family==='policy').length?releaseVol:35],
    ['geopolitical',30],
    ['commodity-shock',marketAnalytics.breadth?.commodity?.averageChangePercent!=null?clamp(Math.abs(marketAnalytics.breadth.commodity.averageChangePercent)*12,0,100):30],
    ['data-quality',100-dataQuality.overall],
  ].map(([id,score])=>{
    score=Math.round(score);
    const severity=score>=75?'high':score>=50?'elevated':score>=30?'moderate':'low';
    const confidenceHaircut=Math.round(score*.18);
    return {id,score,severity,confidenceHaircut,warning:score>=50,stressMultiplier:Number((1+score/100).toFixed(2))};
  });
  const aggregate=Math.round(mean(categories.map(x=>x.score)));
  return {generatedAt:iso(),aggregate,severity:aggregate>=70?'high':aggregate>=50?'elevated':aggregate>=30?'moderate':'low',confidenceAfterRisk:Math.max(0,Math.round(confidenceMean-mean(categories.map(x=>x.confidenceHaircut)))),nextHighImpact:nextHigh?{id:nextHigh.id,event:nextHigh.event,currency:nextHigh.currency,date:nextHigh.date,minutes:mins}:null,categories};
}

function buildRegimes(features=[],economyAnalysis={}){
  const familyGroups={};
  for(const f of features){const k=`${f.economy}:${f.family}`;(familyGroups[k]??=[]).push(f);}
  const regimes=[];
  for(const [key,group] of Object.entries(familyGroups)){
    const [economy,family]=key.split(':');
    const z=mean(group.map(x=>clamp(x.zScore,-3,3))),momentum=mean(group.map(x=>Math.sign(x.momentum)));
    const score=clamp(35*z+15*momentum,-100,100);
    const state=score>25?'expanding':score<-25?'contracting':'balanced';
    const transitionProbability=clamp(sigmoid((Math.abs(score)-25)/18),.05,.95);
    regimes.push({economy,family,score:Number(score.toFixed(1)),state,transitionProbability:Number(transitionProbability.toFixed(3)),sampleSize:group.length});
  }
  const existing=(economyAnalysis?.economies||[]).map(e=>({economy:e.id,family:'composite',score:Number(e.score??e.currencyScore??0),state:e.regime||'balanced',transitionProbability:Number((.5+Math.min(.45,Math.abs(Number(e.score??0))/200)).toFixed(3)),sampleSize:e.observationCount||0}));
  return [...existing,...regimes].slice(0,120);
}

function buildProvenance({observations,events,market,news,features,forecasts,releaseAnalytics,risk,scenarios}){
  const generatedAt=iso();
  const records={
    macro:hash(observations),calendar:hash(events),market:hash(market),news:hash(news),features:hash(features),
    forecasts:hash(forecasts),releaseAnalytics:hash(releaseAnalytics),risk:hash(risk),scenarios:hash(scenarios),
  };
  return {generatedAt,modelVersion:'institutional-research-1.0',retrievalTimestamp:generatedAt,hashes:records,reproducibilityHash:hash(records),transformations:['schema-validation','freshness-check','robust-outlier-screen','feature-engineering','walk-forward-model-calibration','adaptive-forecast-ensemble','model-disagreement-uncertainty','forecast-error-attribution','model-drift-detection','drift-adjusted-confidence','uncertainty-calibration','release-surprise-normalization','regime-classification','risk-haircut','scenario-shock']};
}

function buildOperatingStandards(dataQuality){
  const sloTargets=[
    {id:'collector-uptime',target:99.5,window:'30d'},
    {id:'calendar-freshness',target:99.0,window:'7d'},
    {id:'macro-freshness',target:98.5,window:'7d'},
    {id:'market-price-freshness',target:99.0,window:'7d'},
    {id:'news-freshness',target:98.0,window:'7d'},
    {id:'live-update-delivery',target:99.0,window:'7d'},
    {id:'model-output-health',target:98.5,window:'30d'},
  ];
  return {
    slos:sloTargets.map(x=>({...x,errorBudget:Number((100-x.target).toFixed(2))})),
    storageTiers:{
      hot:{retention:'7d',purpose:'live dashboard and event studies'},
      warm:{retention:'1y',purpose:'research, calibration and backtests'},
      cold:{retention:'5y+',purpose:'audit, model evaluation and reproducibility'},
    },
    validationState:dataQuality.severity,
    contracts:{schemaVersion:'2026-08',typedErrors:true,provenance:true,paginationReady:true,idempotency:true},
  };
}

const DOMAIN_COVERAGE=[
  [1,'Data acquisition & source coverage','active'],
  [2,'Economic calendar intelligence','active'],
  [3,'Historical calendar & event memory','active'],
  [4,'Macro series expansion','active'],
  [5,'International macro coverage','active'],
  [6,'Central-bank intelligence','active'],
  [7,'Speech, minutes & document analysis','foundation'],
  [8,'News & narrative intelligence','active'],
  [9,'Cross-asset market data','active'],
  [10,'Rates, bonds & yield-curve analytics','foundation'],
  [11,'Commodity & inflation transmission','foundation'],
  [12,'Data quality & validation','active'],
  [13,'Provenance, lineage & auditability','active'],
  [14,'Storage & data-lake design','active'],
  [15,'Feature engineering','active'],
  [16,'Econometric forecasting','active'],
  [17,'Machine-learning forecasting','foundation'],
  [18,'Probability & uncertainty modeling','active'],
  [19,'Macro regime detection','active'],
  [20,'Currency strength engine','active'],
  [21,'Currency-pair decision engine','active'],
  [22,'Decision explainability','active'],
  [23,'Event study & backtesting','history-building'],
  [24,'Release surprise analytics','active'],
  [25,'Risk & positioning intelligence','active'],
  [26,'Scenario analysis & stress testing','active'],
  [27,'Dashboard information architecture','active'],
  [28,'Charts & visual analytics','foundation'],
  [29,'Economic calendar UI','active'],
  [30,'Mobile & responsive UX','active'],
  [31,'Frontend performance','foundation'],
  [32,'Accessibility','active'],
  [33,'API design & backend contracts','foundation'],
  [34,'Compute architecture','active'],
  [35,'Task scheduling','active'],
  [36,'Edge delivery','active'],
  [37,'CI/CD','active'],
  [38,'Security & secrets management','active'],
  [39,'Observability & reliability','active'],
  [40,'Testing & quality engineering','foundation'],
];

export function buildInstitutionalResearch({observations=[],events=[],market=[],news=[],economyAnalysis={},currencyStates=[],opportunities=[]}={}){
  const dataQuality=buildDataQuality({observations,events,market,news});
  const sourceReliability=buildSourceReliability(observations);
  const features=buildFeatures(observations);
  const forecasts=buildForecasts(observations);
  const modelHealth=buildModelHealth(forecasts);
  const releaseAnalytics=buildReleaseAnalytics(events);
  const marketAnalytics=buildMarketAnalytics(market);
  const regimes=buildRegimes(features,economyAnalysis);
  const scenarios=buildScenarios(currencyStates,opportunities);
  const risk=buildRisk({dataQuality,marketAnalytics,events,currencyStates,opportunities,releaseAnalytics});
  const operatingStandards=buildOperatingStandards(dataQuality);
  const provenance=buildProvenance({observations,events,market,news,features,forecasts,releaseAnalytics,risk,scenarios});
  return {
    schemaVersion:1,generatedAt:iso(),
    dataQuality,sourceReliability,modelHealth,features:features.slice(0,220),forecasts,releaseAnalytics,marketAnalytics,regimes,risk,scenarios,
    operatingStandards,provenance,
    capabilityCoverage:{domains:DOMAIN_COVERAGE.map(([id,name,status])=>({id,name,status})),active:DOMAIN_COVERAGE.filter(x=>x[2]==='active').length,foundation:DOMAIN_COVERAGE.filter(x=>x[2]==='foundation').length,historyBuilding:DOMAIN_COVERAGE.filter(x=>x[2]==='history-building').length,total:40},
    notes:{
      eventStudies:'Reaction windows become statistically valid as release-aligned market snapshots accumulate. No synthetic returns are fabricated.',
      forecasting:'Current econometric layer uses AR(1), exponential smoothing and state-space estimates with ensemble uncertainty. More complex models are gated by sample sufficiency.',
      positioning:'Direct institutional positioning is not inferred when a verified positioning feed is absent; risk scores use observable proxies only.',
    },
  };
}
