import { Firestore } from '@google-cloud/firestore';
import { summarizeEventStudies } from './event-study.js';
import { fetchCalendarHistoryWindow } from './calendar-history-60d.js';
import { buildMT5EventPriceStudy, MT5_EVENT_ASSETS, MT5_EVENT_HORIZONS, MT5_PRE_NEWS_WINDOWS } from './mt5-event-price-history.js';

const db=new Firestore({ignoreUndefinedProperties:true});
const state=db.collection('fxga_collector_state');
const calendarHistory=db.collection('fxga_calendar_history');
const eventStudies=db.collection('fxga_event_studies');
const DAY_MS=86_400_000;
const RETENTION_DAYS=60;

const hasActual=value=>value!=null&&String(value).trim()!==''&&!['-','—','null'].includes(String(value).trim().toLowerCase());
const completed24h=study=>study?.horizons?.['24h']?.quality==='measured'&&Number(study?.horizons?.['24h']?.usableAssets||0)>0;

async function persistCalendarHistory(events){
  let written=0;for(let offset=0;offset<events.length;offset+=400){const batch=db.batch();for(const event of events.slice(offset,offset+400)){batch.set(calendarHistory.doc(event.id),{...event,archivedAt:new Date().toISOString(),retentionWindowDays:RETENTION_DAYS,priceResearchUniverse:[...MT5_EVENT_ASSETS],preNewsWindows:Object.values(MT5_PRE_NEWS_WINDOWS)},{merge:true});written++;}await batch.commit();}return written;
}
async function calendarEvents(days){
  const[historical,current]=await Promise.all([fetchCalendarHistoryWindow({days}),state.doc('calendar').get()]),currentEvents=current.exists?current.data()?.payload?.events||[]:[],merged=new Map();
  for(const event of[...historical.events,...currentEvents])if(event?.id)merged.set(event.id,{...(merged.get(event.id)||{}),...event});
  const now=Date.now(),cutoff=now-days*DAY_MS,events=[...merged.values()].filter(event=>{const time=Date.parse(event?.date||'');return Number.isFinite(time)&&time<=now&&time>=cutoff&&hasActual(event?.actual);}).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)),persisted=await persistCalendarHistory(events);return{events,persisted,failures:historical.failures};
}
async function existingStudies(days){const cutoff=new Date(Date.now()-days*DAY_MS).toISOString(),query=await eventStudies.where('releaseAt','>=',cutoff).limit(3000).get();return new Map(query.docs.map(doc=>[doc.id,doc.data()]));}
async function publishState(days){
  const cutoff=new Date(Date.now()-days*DAY_MS).toISOString(),query=await eventStudies.where('releaseAt','>=',cutoff).limit(3000).get(),studies=query.docs.map(doc=>doc.data()).sort((a,b)=>Date.parse(b?.releaseAt||0)-Date.parse(a?.releaseAt||0)),payload={generatedAt:new Date().toISOString(),days,source:'MetaTrader5 canonical M1 + FXStreet economic calendar history',priceUniverse:[...MT5_EVENT_ASSETS],preNewsWindows:Object.values(MT5_PRE_NEWS_WINDOWS),horizons:Object.values(MT5_EVENT_HORIZONS),summary:summarizeEventStudies(studies),studies};await state.doc('event-studies').set({updatedAt:payload.generatedAt,payload},{merge:true});return payload;
}

export async function backfillEventStudies({days=RETENTION_DAYS,maxEvents=1200,force=false}={}){
  days=Math.min(RETENTION_DAYS,Math.max(1,Number(days)||RETENTION_DAYS));maxEvents=Math.min(3000,Math.max(1,Number(maxEvents)||1200));
  const[{events,persisted,failures},existing]=await Promise.all([calendarEvents(days),existingStudies(days)]),now=Date.now(),candidates=events.filter(event=>{if(force)return true;const previous=existing.get(event.id);if(!previous)return true;const releaseMs=Date.parse(event.date||'');if(!Number.isFinite(releaseMs))return false;if(now-releaseMs<25*60*60_000)return true;return!completed24h(previous)||!previous?.preNews?.crossAsset?.profileSignature;}).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)).slice(0,maxEvents);

  let studiesTouched=0,measurementsWritten=0,measured=0,unavailable=0,assetsMeasured=0,preNewsProfiles=0;const chunkCache=new Map();
  for(const event of candidates){
    const priceStudy=await buildMT5EventPriceStudy(event,{chunkCache});if(!priceStudy)continue;const previous=existing.get(event.id)||{},horizons={...(previous.horizons||{}),...(priceStudy.horizons||{})};
    for(const measurement of Object.values(priceStudy.horizons||{})){measurementsWritten++;if(measurement?.quality==='measured'){measured++;assetsMeasured+=Number(measurement.usableAssets||0);}else unavailable++;}
    preNewsProfiles+=Number(priceStudy?.preNews?.crossAsset?.usableAssets||0);
    await eventStudies.doc(event.id).set({eventId:event.id,event:event.event,currency:event.currency,country:event.country,category:event.category,importance:event.importance,releaseAt:event.date,releaseDateUtc:priceStudy?.timeSignature?.dateUtc??null,timeSignature:priceStudy.timeSignature,actual:event.actual??null,forecast:event.forecast??null,previous:event.previous??null,revised:event.revised??null,outcome:event.outcome??null,currencyBias:event.currencyBias??'neutral',currencyBiasScore:event.currencyBiasScore??0,biasConfidence:event.biasConfidence??null,surpriseValue:event.surpriseValue??null,surprisePercent:event.surprisePercent??null,interpretationFamily:event.interpretationFamily??null,priceSource:priceStudy.source,sourceTimeframe:priceStudy.sourceTimeframe,priceUniverse:priceStudy.assets,profileSignature:priceStudy.profileSignature,preNews:priceStudy.preNews,horizonOrder:Object.values(MT5_EVENT_HORIZONS),horizons,backfilledAt:new Date().toISOString(),updatedAt:new Date().toISOString()},{merge:true});studiesTouched++;
  }
  const priceChunkCacheEntries=chunkCache.size;chunkCache.clear();const published=await publishState(days);
  return{days,retentionPolicy:'60-day one-time M1 bootstrap followed by incremental updates; full UTC-day chunks retire by FIFO only after they fall entirely outside the rolling window; derived event studies persist beyond raw-price FIFO',calendarEvents:events.length,calendarEventsPersisted:persisted,calendarFetchFailures:failures,candidateEvents:candidates.length,studiesTouched,measurementsWritten,measured,unavailable,assetsMeasured,preNewsProfiles,priceChunkCacheEntries,priceUniverse:[...MT5_EVENT_ASSETS],preNewsWindows:Object.values(MT5_PRE_NEWS_WINDOWS),horizons:Object.values(MT5_EVENT_HORIZONS),summary:published.summary};
}
