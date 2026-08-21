import { Firestore } from '@google-cloud/firestore';

const db=new Firestore({ignoreUndefinedProperties:true});
const state=db.collection('fxga_collector_state');
const marketSnapshots=db.collection('fxga_market_snapshots');
const HOUR_MS=3_600_000;

const ECONOMY_BY_CURRENCY={USD:'USA',EUR:'EUROPE',GBP:'UK',ZAR:'SOUTH_AFRICA',JPY:'JAPAN'};
const FAMILY_TERMS={
  'policy-inflation':['inflation','cpi','pce','ppi','wage','earnings'],
  'policy-rate':['policy-rate','fedfunds','interest','rate','sofr','repo'],
  'labour-slack':['employment','unemployment','payroll','claims','wage','earnings'],
  'growth-activity':['growth','gdp','retail','industry','production','pmi','housing','confidence'],
  'external-balance':['trade','current-account','currency','reserves'],
};
const words=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(Boolean);

async function readState(name){const snap=await state.doc(name).get();return snap.exists?snap.data()?.payload||null:null;}
function nearestHistory(history,eventMs){const rows=(Array.isArray(history)?history:[]).map(row=>({...row,ms:Date.parse(row?.date||'')})).filter(row=>Number.isFinite(row.ms)&&Number.isFinite(Number(row.value))).sort((a,b)=>a.ms-b.ms),prior=rows.filter(row=>row.ms<=eventMs);const current=prior.at(-1)||null,previous=prior.at(-2)||null;return current?{date:current.date,value:Number(current.value),previousDate:previous?.date||null,previous:previous?Number(previous.value):null,ageDays:Number(((eventMs-current.ms)/86400000).toFixed(2))}:null;}
function scoreObservation(observation,event){const economy=ECONOMY_BY_CURRENCY[String(event?.currency||'').toUpperCase()],family=String(event?.interpretationFamily||''),terms=FAMILY_TERMS[family]||words(event?.event),text=`${observation?.seriesId||''} ${observation?.title||''} ${(observation?.categories||[]).join(' ')}`.toLowerCase();let score=0;if(economy&&((observation?.economies||[]).includes(economy)||observation?.economy===economy))score+=20;for(const term of terms)if(text.includes(term))score+=4;if(String(observation?.importance)==='critical')score+=5;return score;}

async function fredEvidence(event){const macro=await readState('macro').catch(()=>null),eventMs=Date.parse(event?.date||event?.releaseAt||'');if(!macro||!Number.isFinite(eventMs))return{status:'unavailable',source:'FRED',series:[]};const ranked=(macro.observations||[]).map(observation=>({observation,score:scoreObservation(observation,event)})).filter(row=>row.score>0).sort((a,b)=>b.score-a.score).slice(0,8),series=[];for(const {observation,score} of ranked){const atRelease=nearestHistory(observation.history,eventMs);if(!atRelease)continue;series.push({seriesId:observation.seriesId,title:observation.title,economy:observation.economy||null,categories:observation.categories||[],units:observation.units||'',frequency:observation.frequency||'',score,atRelease,source:observation.source||'FRED'});}return{status:series.length?'available':'unavailable',source:'FRED',generatedAt:macro.generatedAt||null,series};}

function compactMarketSnapshot(snapshot){if(!snapshot)return null;return{capturedAt:snapshot.capturedAt||null,source:snapshot.source||'CNBC',assets:(snapshot.assets||[]).filter(asset=>Number.isFinite(Number(asset?.price))).map(asset=>({id:asset.id,name:asset.name||asset.id,price:Number(asset.price),changePercent:Number.isFinite(Number(asset.changePercent))?Number(asset.changePercent):null,source:asset.source||snapshot.source||'CNBC'}))};}
async function cnbcEvidence(event){const eventMs=Date.parse(event?.date||event?.releaseAt||'');if(!Number.isFinite(eventMs))return{status:'unavailable',source:'CNBC',before:null,after:null};const from=new Date(eventMs-2*HOUR_MS).toISOString(),to=new Date(eventMs+2*HOUR_MS).toISOString();try{const query=await marketSnapshots.where('capturedAt','>=',from).where('capturedAt','<=',to).orderBy('capturedAt','asc').limit(80).get(),rows=query.docs.map(doc=>doc.data()).filter(row=>Number.isFinite(Date.parse(row?.capturedAt||''))),before=rows.filter(row=>Date.parse(row.capturedAt)<=eventMs).at(-1)||null,after=rows.find(row=>Date.parse(row.capturedAt)>=eventMs)||null;return{status:before||after?'available':'unavailable',source:'CNBC persisted market snapshots',windowHours:2,before:compactMarketSnapshot(before),after:compactMarketSnapshot(after)};}catch(error){return{status:'unavailable',source:'CNBC persisted market snapshots',before:null,after:null,error:String(error?.message||error).slice(0,180)};}}

export async function buildEventEvidenceBundle(event){const[fred,cnbc]=await Promise.all([fredEvidence(event),cnbcEvidence(event)]);return{schema:'fxga.event.evidence.v1',generatedAt:new Date().toISOString(),releaseAt:event?.date||event?.releaseAt||null,authority:{release:'FXStreet/current calendar archive',pricePath:'MetaTrader 5 canonical M1',macroContext:'FRED',marketContext:'CNBC persisted snapshots'},rules:['MT5 remains the historical price-path authority.','FRED evidence is aligned to the latest observation available on or before the release timestamp.','CNBC snapshots are context/cross-check evidence and never replace historical MT5 candles.','Missing evidence remains unavailable and is never synthesized.'],fred,cnbc};}
