import crypto from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { budgetedJson } from './market-data-budget.js';
import { TECHNICAL_ASSET_IDS, buildTechnicalSnapshot, updateTechnicalBars } from './technical-engine.js';

const db=new Firestore({ignoreUndefinedProperties:true});
const state=db.collection('fxga_collector_state');
const marketBars=db.collection('fxga_market_bars');
const marketSnapshots=db.collection('fxga_market_snapshots');
const MINUTE=60_000;
const HOUR=60*MINUTE;
const DAY=24*HOUR;
const BAR_CAPS={M5:720,M15:640,H1:480,H4:300,D1:220};
const REQUIRED={M5:48,M15:40,H1:30,H4:24,D1:20};

const HISTORY_SYMBOLS=Object.freeze([
  {id:'EURUSD',symbol:'EUR/USD',label:'EUR / U.S. Dollar'},
  {id:'GBPUSD',symbol:'GBP/USD',label:'GBP / U.S. Dollar'},
  {id:'USDJPY',symbol:'USD/JPY',label:'U.S. Dollar / Japanese Yen'},
  {id:'USDZAR',symbol:'USD/ZAR',label:'U.S. Dollar / South African Rand'},
  {id:'EURZAR',symbol:'EUR/ZAR',label:'EUR / South African Rand'},
  {id:'GBPZAR',symbol:'GBP/ZAR',label:'GBP / South African Rand'},
  {id:'EURGBP',symbol:'EUR/GBP',label:'EUR / GBP'},
  {id:'XAUUSD',symbol:'XAU/USD',label:'Gold / U.S. Dollar'},
]);
const HISTORY_ASSET_IDS=HISTORY_SYMBOLS.map(item=>item.id);

const finite=value=>{const n=typeof value==='number'?value:Number(String(value??'').replace(/,/g,'').trim());return Number.isFinite(n)?n:null;};
const stableHash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const bucket=(time,interval)=>Math.floor(time/interval)*interval;

function providerTime(value){
  if(typeof value!=='string'||!value.trim())return null;
  const normalized=value.includes('T')?value.trim():value.trim().replace(' ','T');
  const time=Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(normalized)?normalized:`${normalized}Z`);
  return Number.isFinite(time)?time:null;
}

function directBars(values,intervalMs,source){
  const rows=[];
  for(const item of Array.isArray(values)?values:[]){
    const time=providerTime(item?.datetime),open=finite(item?.open),high=finite(item?.high),low=finite(item?.low),close=finite(item?.close);
    if(time==null||[open,high,low,close].some(value=>value==null))continue;
    const start=bucket(time,intervalMs);
    rows.push({start:new Date(start).toISOString(),end:new Date(start+intervalMs).toISOString(),open,high,low,close,samples:1,providerOhlc:true,source,firstSampleAt:new Date(start).toISOString(),lastSampleAt:new Date(start+intervalMs-1).toISOString(),synthetic:false});
  }
  return [...new Map(rows.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)).map(row=>[row.start,row])).values()];
}

function aggregateBars(input,intervalMs,source){
  const groups=new Map();
  for(const bar of input){
    const time=Date.parse(bar.start);if(!Number.isFinite(time))continue;
    const start=bucket(time,intervalMs),key=String(start),current=groups.get(key);
    if(!current){groups.set(key,{start:new Date(start).toISOString(),end:new Date(start+intervalMs).toISOString(),open:bar.open,high:bar.high,low:bar.low,close:bar.close,samples:Number(bar.samples||1),providerOhlc:true,source,firstSampleAt:bar.start,lastSampleAt:bar.end,synthetic:false});continue;}
    current.high=Math.max(current.high,bar.high);current.low=Math.min(current.low,bar.low);current.close=bar.close;current.samples+=Number(bar.samples||1);current.lastSampleAt=bar.end;
  }
  return [...groups.values()].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
}

function mergeBars(existing,incoming,cap){
  const rows=new Map();
  for(const bar of Array.isArray(existing)?existing:[])if(bar?.start)rows.set(bar.start,{...bar});
  for(const bar of Array.isArray(incoming)?incoming:[])if(bar?.start){
    const previous=rows.get(bar.start);
    // Verified provider OHLC is authoritative for the same bucket; sampled-close data cannot overwrite it.
    if(!previous||bar.providerOhlc||!previous.providerOhlc)rows.set(bar.start,{...previous,...bar});
  }
  return [...rows.values()].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)).slice(-cap);
}

async function loadStates(){
  const entries=await Promise.all(TECHNICAL_ASSET_IDS.map(async id=>{const snap=await marketBars.doc(id).get();return [id,snap.exists?snap.data():null];}));
  return Object.fromEntries(entries.map(([id,value])=>[id,value&&typeof value==='object'?value:{id,label:HISTORY_SYMBOLS.find(x=>x.id===id)?.label||id,symbol:id,synthetic:false,legs:null,updatedAt:null,lastPrice:null,bars:{}}]));
}

function historyProgress(states){
  const perAsset={};let earned=0,total=0;
  for(const id of HISTORY_ASSET_IDS){
    const frames={};
    for(const [timeframe,required] of Object.entries(REQUIRED)){
      const bars=Array.isArray(states?.[id]?.bars?.[timeframe])?states[id].bars[timeframe].length:0;
      const progress=Math.min(100,Math.round((bars/required)*100));
      frames[timeframe]={bars,requiredBars:required,progress};earned+=Math.min(bars,required);total+=required;
    }
    perAsset[id]=frames;
  }
  return {overallPercent:total?Math.round((earned/total)*100):0,perAsset,measuredBars:earned,requiredBars:total,trackedAssets:HISTORY_ASSET_IDS.length,updatedAt:new Date().toISOString()};
}

async function persistStates(states,generatedAt,reason){
  const batchWrite=db.batch();
  for(const id of TECHNICAL_ASSET_IDS)batchWrite.set(marketBars.doc(id),states[id],{merge:false});
  await batchWrite.commit();
  const technical={...buildTechnicalSnapshot(states,generatedAt),historyBuild:historyProgress(states),historySource:reason};
  await state.doc('technical').set({hash:stableHash(technical),updatedAt:generatedAt,payload:technical},{merge:false});
  return technical;
}

async function waitForMinuteBudget(){
  const wait=60_000-(Date.now()%60_000)+1_500;
  await sleep(wait);
}

async function fetchTwelveSeries(item,interval,outputsize){
  const key=String(process.env.TWELVE_DATA_API_KEY||'').trim();
  if(!key)return {ok:false,skipped:true,reason:'credential-not-configured'};
  const url=new URL('https://api.twelvedata.com/time_series');
  url.searchParams.set('symbol',item.symbol);url.searchParams.set('interval',interval);url.searchParams.set('outputsize',String(outputsize));url.searchParams.set('timezone','UTC');url.searchParams.set('order','ASC');url.searchParams.set('apikey',key);
  const options={cost:1,taskKey:`technical-history:${interval}:${item.id}`,ttlMs:24*HOUR,timeoutMs:15_000,maxResponseBytes:1_500_000};
  for(let attempt=0;attempt<4;attempt++){
    const result=await budgetedJson('twelve_data',url,options);
    if(result?.reason==='minute-budget-exhausted'){await waitForMinuteBudget();continue;}
    return result;
  }
  return {ok:false,skipped:true,reason:'minute-budget-retry-exhausted'};
}

async function fetchInterval(interval,outputsize){
  const result={};
  for(const item of HISTORY_SYMBOLS){
    const response=await fetchTwelveSeries(item,interval,outputsize);
    const values=response?.ok&&response.data?.status!=='error'&&Array.isArray(response.data?.values)?response.data.values:[];
    result[item.id]={item,response:{ok:Boolean(response?.ok&&values.length),skipped:Boolean(response?.skipped),reason:response?.reason||response?.data?.message||response?.error||null,status:response?.status??null},values};
  }
  return result;
}

export async function bootstrapVerifiedTechnicalHistory(){
  const before=await loadStates();
  const beforeProgress=historyProgress(before);
  if(beforeProgress.overallPercent>=95)return {changed:false,reason:'history-already-mature',before:beforeProgress,after:beforeProgress};

  // Each source timeframe is genuine provider OHLC. Lower bars are aggregated rather than invented.
  // 1m -> M5, 5m -> M15/H1, 1h -> H4, 1day -> D1.
  const oneMinute=await fetchInterval('1min',400);
  const fiveMinute=await fetchInterval('5min',500);
  const hourly=await fetchInterval('1h',150);
  const daily=await fetchInterval('1day',35);
  const states=await loadStates();
  const diagnostics={};

  for(const item of HISTORY_SYMBOLS){
    const m1=directBars(oneMinute[item.id]?.values,MINUTE,'twelve-data-verified-1m-ohlc');
    const m5Source=directBars(fiveMinute[item.id]?.values,5*MINUTE,'twelve-data-verified-5m-ohlc');
    const h1Source=directBars(hourly[item.id]?.values,HOUR,'twelve-data-verified-1h-ohlc');
    const d1=directBars(daily[item.id]?.values,DAY,'twelve-data-verified-1d-ohlc');
    const incoming={
      M5:aggregateBars(m1,5*MINUTE,'twelve-data-verified-1m-to-5m-ohlc'),
      M15:aggregateBars(m5Source,15*MINUTE,'twelve-data-verified-5m-to-15m-ohlc'),
      H1:aggregateBars(m5Source,HOUR,'twelve-data-verified-5m-to-1h-ohlc'),
      H4:aggregateBars(h1Source,4*HOUR,'twelve-data-verified-1h-to-4h-ohlc'),
      D1:d1,
    };
    const previous=states[item.id]||{id:item.id,bars:{}};
    const bars={...(previous.bars||{})};
    for(const timeframe of Object.keys(REQUIRED))bars[timeframe]=mergeBars(bars[timeframe],incoming[timeframe],BAR_CAPS[timeframe]);
    const latest=[...m1,...m5Source,...h1Source,...d1].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)).at(-1);
    states[item.id]={...previous,id:item.id,label:item.label,symbol:item.id,synthetic:false,updatedAt:new Date().toISOString(),lastPrice:latest?.close??previous.lastPrice??null,bars};
    diagnostics[item.id]={
      oneMinute:oneMinute[item.id]?.response,fiveMinute:fiveMinute[item.id]?.response,hourly:hourly[item.id]?.response,daily:daily[item.id]?.response,
      imported:{M5:incoming.M5.length,M15:incoming.M15.length,H1:incoming.H1.length,H4:incoming.H4.length,D1:incoming.D1.length},
    };
  }

  const generatedAt=new Date().toISOString();
  const technical=await persistStates(states,generatedAt,'verified Twelve Data OHLC bootstrap + ongoing Google Cloud authoritative market sampling');
  const after=technical.historyBuild;
  return {changed:after.overallPercent!==beforeProgress.overallPercent,before:beforeProgress,after,diagnostics,generatedAt};
}

export async function persistAuthoritativeMarketSample(snapshot){
  if(!snapshot||!Array.isArray(snapshot.assets)||!snapshot.assets.length)return {changed:false,reason:'no-market-assets'};
  const generatedAt=snapshot.generatedAt||new Date().toISOString();
  const states=await loadStates();
  const next=updateTechnicalBars(states,{...snapshot,generatedAt});
  const historyId=generatedAt.slice(0,16).replace(/[-:T]/g,'');
  await marketSnapshots.doc(historyId).set({capturedAt:generatedAt,source:snapshot.source||'FXGA delegated market ensemble',assets:snapshot.assets.map(({error,...asset})=>asset),authoritativeTechnicalSample:true},{merge:true});
  const technical=await persistStates(next,generatedAt,'Google Cloud authoritative delegated market samples + verified historical OHLC');
  return {changed:true,generatedAt,counts:technical.counts,historyBuild:technical.historyBuild};
}
