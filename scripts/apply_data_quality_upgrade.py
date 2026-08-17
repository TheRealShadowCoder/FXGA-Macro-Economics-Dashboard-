from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def read(path): return (ROOT/path).read_text(encoding='utf-8')
def write(path,text): (ROOT/path).write_text(text,encoding='utf-8')
def replace_once(text,old,new,label):
    if old not in text: raise SystemExit(f'Patch anchor missing: {label}')
    return text.replace(old,new,1)

runtime_path='cloud-run-collector/src/super-runtime.js'
runtime=read(runtime_path)
runtime=replace_once(runtime,
    "function ageMinutes(value){const t=Date.parse(value||'');return Number.isFinite(t)?Math.max(0,Math.round((Date.now()-t)/60000)):null;}",
    """function ageMinutes(value){const t=Date.parse(value||'');return Number.isFinite(t)?Math.max(0,Math.round((Date.now()-t)/60000)):null;}
function classifyMacroFailure(message=''){
  const text=String(message||'').toLowerCase();
  if(/http 429|rate limit|too many requests/.test(text))return {type:'rate-limited',retryable:true};
  if(/http 5\d\d|econnreset|socket|temporar|upstream/.test(text))return {type:'transient-upstream',retryable:true};
  if(/timeout|timed out|abort/.test(text))return {type:'timeout',retryable:true};
  if(/http 404|not found|does not exist/.test(text))return {type:'series-unavailable',retryable:false};
  if(/no current numeric observation|no observation|non.?numeric/.test(text))return {type:'no-current-observation',retryable:false};
  if(/invalid|parse|json/.test(text))return {type:'invalid-response',retryable:true};
  if(/api key|unauthor|forbidden|http 401|http 403/.test(text))return {type:'authorization',retryable:false};
  return {type:'other',retryable:true};
}
function macroFailureDiagnostics(failures=[],requested=0,liveFetched=0,staleRetained=0,observations=0){
  const byType={},byEconomy={},byCategory={};let retryable=0,nonRetryable=0;
  for(const failure of failures){
    const type=failure.type||classifyMacroFailure(failure.error).type;
    byType[type]=(byType[type]||0)+1;
    const economy=failure.economy||'UNKNOWN',category=failure.category||'other';
    byEconomy[economy]=(byEconomy[economy]||0)+1;byCategory[category]=(byCategory[category]||0)+1;
    if(failure.retryable??classifyMacroFailure(failure.error).retryable)retryable++;else nonRetryable++;
  }
  const unresolved=Math.max(0,Number(requested||0)-Number(observations||0));
  const liveRatio=requested?liveFetched/requested:0,effectiveRatio=requested?observations/requested:0;
  return {total:failures.length,retryable,nonRetryable,unresolved,byType,byEconomy,byCategory,liveRatio,effectiveRatio,requested,liveFetched,staleRetained,observations};
}""",
    'failure classifier')

old="settled.forEach((result,index)=>{if(result.status==='fulfilled'&&result.value.value!==null)fresh.push(result.value);else failures.push({seriesId:batch[index]?.seriesId||'unknown',error:result.status==='rejected'?String(result.reason?.message||result.reason).slice(0,180):'No current numeric observation'});});"
new="""settled.forEach((result,index)=>{if(result.status==='fulfilled'&&result.value.value!==null)fresh.push(result.value);else {const descriptor=batch[index]||{},error=result.status==='rejected'?String(result.reason?.message||result.reason).slice(0,180):'No current numeric observation',classification=classifyMacroFailure(error);failures.push({seriesId:descriptor.seriesId||'unknown',title:descriptor.title||descriptor.seriesId||'unknown',economy:descriptor.economy||'UNKNOWN',category:descriptor.category||'other',error,type:classification.type,retryable:classification.retryable});}});"""
runtime=replace_once(runtime,old,new,'enrich macro failures')

old="const staleRetained=observations.filter(x=>x.staleFallback).length,snapshot={generatedAt:new Date().toISOString(),mode:'full',importantOnly:true,dynamicInternational:true,targetEconomies:TARGET_ECONOMIES,requested:descriptors.length,observations,liveFetched:fresh.length,staleRetained,universeSummary:universe.summary,failures:failures.slice(0,60),officialSources:universe.officialSources||[],collectionArchitecture:'google-cloud-cached-universe-observation-sync-with-last-known-good'};"
new="""const staleRetained=observations.filter(x=>x.staleFallback).length,failureDiagnostics=macroFailureDiagnostics(failures,descriptors.length,fresh.length,staleRetained,observations.length),coverageQuality={requested:descriptors.length,liveFetched:fresh.length,retainedLastKnownGood:staleRetained,usableObservations:observations.length,unresolved:failureDiagnostics.unresolved,liveCoveragePercent:Number((failureDiagnostics.liveRatio*100).toFixed(1)),effectiveCoveragePercent:Number((failureDiagnostics.effectiveRatio*100).toFixed(1)),status:failureDiagnostics.effectiveRatio>=.9?'strong':failureDiagnostics.effectiveRatio>=.75?'acceptable':'degraded'},snapshot={generatedAt:new Date().toISOString(),mode:'full',importantOnly:true,dynamicInternational:true,targetEconomies:TARGET_ECONOMIES,requested:descriptors.length,observations,liveFetched:fresh.length,staleRetained,coverageQuality,failureDiagnostics,universeSummary:universe.summary,failures:failures.slice(0,60),officialSources:universe.officialSources||[],collectionArchitecture:'primary-macro-observation-sync-with-last-known-good'};"""
runtime=replace_once(runtime,old,new,'macro quality snapshot')

old="return {generatedAt:new Date().toISOString(),status:criticalIssues.length?'degraded':'healthy',criticalIssues,calendarEvents:calendar?.payload?.events?.length||0,macroObservations:observations.length,fredRequested:macro?.payload?.requested||0,fredLiveFetched:macro?.payload?.liveFetched??macro?.payload?.fetchedNow??null,fredFailures:fredFailures.length,staleMacroRetained:staleMacro,officialNewsItems:news?.items?.length||0,staleNewsRetained:news?.staleRetained||0,economyCounts,sourceChecks,agesMinutes:{calendar:ageMinutes(calendar?.payload?.generatedAt||calendar?.updatedAt),macro:ageMinutes(macro?.payload?.generatedAt||macro?.updatedAt),news:ageMinutes(news?.generatedAt),intelligence:ageMinutes(intelligence?.generatedAt)}};"
new="""const macroQuality=macro?.payload?.coverageQuality||{requested:macro?.payload?.requested||0,liveFetched:macro?.payload?.liveFetched??macro?.payload?.fetchedNow??0,retainedLastKnownGood:staleMacro,usableObservations:observations.length,unresolved:Math.max(0,Number(macro?.payload?.requested||0)-observations.length),liveCoveragePercent:null,effectiveCoveragePercent:null,status:'unknown'},failureDiagnostics=macro?.payload?.failureDiagnostics||macroFailureDiagnostics(fredFailures,macroQuality.requested,macroQuality.liveFetched,staleMacro,observations.length);if(Number(macroQuality.effectiveCoveragePercent??100)<75)criticalIssues.push(`Macro effective coverage below 75% (${macroQuality.effectiveCoveragePercent}%)`);
  return {generatedAt:new Date().toISOString(),status:criticalIssues.length?'degraded':'healthy',criticalIssues,calendarEvents:calendar?.payload?.events?.length||0,macroObservations:observations.length,fredRequested:macro?.payload?.requested||0,fredLiveFetched:macro?.payload?.liveFetched??macro?.payload?.fetchedNow??null,fredFailures:fredFailures.length,staleMacroRetained:staleMacro,macroQuality,failureDiagnostics,officialNewsItems:news?.items?.length||0,staleNewsRetained:news?.staleRetained||0,economyCounts,sourceChecks,agesMinutes:{calendar:ageMinutes(calendar?.payload?.generatedAt||calendar?.updatedAt),macro:ageMinutes(macro?.payload?.generatedAt||macro?.updatedAt),news:ageMinutes(news?.generatedAt),intelligence:ageMinutes(intelligence?.generatedAt)}};"""
runtime=replace_once(runtime,old,new,'operational data quality')
write(runtime_path,runtime)

worker_path='worker/index-v3.ts'
worker=read(worker_path)
anchor="if(url.pathname==='/api/dashboard'){const now=Date.now(),calendar=events.filter(e=>Date.parse(e.date)>=now-7*86400000).slice(0,600);return json({generatedAt:intel?.generatedAt??s.meta?.lastWebhookAt??new Date().toISOString(),macro:observations.slice(0,80),calendar,market:Array.isArray(s.market?.assets)?s.market.assets:[],news:intel?.news??[],sources:SOURCE_VIEW,errors:[]});}"
replacement=anchor+"\n      if(url.pathname==='/api/data-quality'){const macro=s.macro??{},quality=macro.coverageQuality??{},diag=macro.failureDiagnostics??{},marketAssets=Array.isArray(s.market?.assets)?s.market.assets:[];return json({generatedAt:macro.generatedAt??s.meta?.lastWebhookAt??null,macro:{coverage:quality,failures:{total:Number(diag.total??macro.failures?.length??0),retryable:Number(diag.retryable??0),nonRetryable:Number(diag.nonRetryable??0),unresolved:Number(diag.unresolved??Math.max(0,Number(macro.requested??0)-observations.length)),byType:diag.byType??{},byEconomy:diag.byEconomy??{},byCategory:diag.byCategory??{},series:(Array.isArray(macro.failures)?macro.failures:[]).slice(0,40).map((item:any)=>({seriesId:item.seriesId,title:item.title??item.seriesId,economy:item.economy??'UNKNOWN',category:item.category??'other',type:item.type??'other',retryable:Boolean(item.retryable)}))}},market:{assets:marketAssets.length,priced:marketAssets.filter((item:any)=>typeof item.price==='number'&&Number.isFinite(item.price)).length,stale:marketAssets.filter((item:any)=>item.stale).length},technical:{assets:Object.keys(s.technical?.assets??{}).length,confirmed:Number(s.technical?.counts?.confirmed??0),warming:Number(s.technical?.counts?.warming??0)},calendar:{events:events.length,sourceHealth:s.calendar?.sourceHealth??{}},publicPolicy:'Quality metrics describe coverage and freshness; unavailable evidence is never synthesized.'});}"
worker=replace_once(worker,anchor,replacement,'public data quality API')
write(worker_path,worker)

print('Macro data-quality integration applied successfully.')
