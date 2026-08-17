from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]

def read(path): return (ROOT/path).read_text(encoding='utf-8')
def write(path,text): (ROOT/path).write_text(text,encoding='utf-8')
def replace_once(text,old,new,label):
    if old not in text: raise SystemExit(f'Patch anchor missing: {label}')
    return text.replace(old,new,1)

worker_path='worker/index-v3.ts'
worker=read(worker_path)
worker=replace_once(worker,
    "function intelligenceFromState(s:Record<string,any>){return s?.intelligence??null;}",
    "function intelligenceFromState(s:Record<string,any>){return s?.intelligence??null;}\nfunction publicIntelligence(intel:any){if(!intel||typeof intel!=='object')return intel;const {executionLocation:_,registry:__,collectorMode:___,...rest}=intel;return rest;}\nfunction publicMode(){return 'authenticated-primary-data-service';}",
    'public intelligence sanitizer')
worker=replace_once(worker,
    "return {generatedAt,mode:'google-cloud-run-webhook',targetEconomies:TARGET_ECONOMIES,totalObservations:observations.length,counts:Object.fromEntries(TARGET_ECONOMIES.map(e=>[e,economies[e].length])),economies,global};",
    "return {generatedAt,mode:publicMode(),targetEconomies:TARGET_ECONOMIES,totalObservations:observations.length,counts:Object.fromEntries(TARGET_ECONOMIES.map(e=>[e,economies[e].length])),economies,global};",
    'public macro mode')

old_health="if(url.pathname==='/api/health')return json({ok:true,app:'FXGA Macro Intelligence',collectorMode:'google-cloud-run-webhook',timestamp:new Date().toISOString(),configured:{fred:false,calendarScraping:false,externalCollectorWebhook:Boolean(env.COLLECTOR_WEBHOOK_SECRET),calendarSources:['Myfxbook','FXStreet','CNBC'],browserRun:false,durableCoordinator:Boolean(env.FXGA_COORDINATOR),officialNewsScraping:false},methodRegistry:intel?.registry??null,scheduler:{initialized:s.initialized,mode:'external-cloud-run-webhook',calendarSyncedAt:s.calendar?.generatedAt??null,nextReleaseAt:s.upcoming?.[0]?.event?.date??null,active:s.active,upcoming:s.upcoming,recent:s.recent,baseline:intel?.macroAnalysis?{generatedAt:intel.generatedAt,analysis:intel.macroAnalysis,observations}:null},safety:{workerSubrequestCeiling:0,collectorMaxConcurrentConnections:0,browserSoftBudgetSecondsPerUtcDay:0,browserSessionReuse:false,releaseMode:'Google Cloud Tasks -> signed webhook',normalStateUpstreamCalendarRequests:0,normalStateUpstreamFredRequests:0,normalStateUpstreamNewsRequests:0,normalStateUpstreamMarketRequests:0,releaseWindowPrimary:'Google Cloud Run collector',cloudflareRole:'receive signed webhooks, persist, serve API/UI and WebSockets only'}},{headers:{'Cache-Control':'no-store'}});"
new_health="if(url.pathname==='/api/health')return json({ok:true,app:'FXGA Macro Intelligence',dataService:'authenticated-primary-data-service',timestamp:new Date().toISOString(),configured:{calendarScraping:false,externalCollectorWebhook:Boolean(env.COLLECTOR_WEBHOOK_SECRET),calendarSources:['Primary calendar','Independent calendar cross-check','Market reference feed'],browserRun:false,durableCoordinator:Boolean(env.FXGA_COORDINATOR),officialNewsScraping:false},scheduler:{initialized:s.initialized,mode:'authenticated-live-updates',calendarSyncedAt:s.calendar?.generatedAt??null,nextReleaseAt:s.upcoming?.[0]?.event?.date??null,active:s.active,upcoming:s.upcoming,recent:s.recent,baseline:intel?.macroAnalysis?{generatedAt:intel.generatedAt,analysis:intel.macroAnalysis,observations}:null},safety:{workerSubrequestCeiling:0,collectorMaxConcurrentConnections:0,browserSoftBudgetSecondsPerUtcDay:0,browserSessionReuse:false,releaseMode:'scheduled release capture -> authenticated live update',normalStateUpstreamCalendarRequests:0,normalStateUpstreamFredRequests:0,normalStateUpstreamNewsRequests:0,normalStateUpstreamMarketRequests:0,releaseWindowPrimary:'primary data service',applicationEdgeRole:'receive authenticated updates, persist state, serve API/UI and live channel'}},{headers:{'Cache-Control':'no-store'}});"
worker=replace_once(worker,old_health,new_health,'public health contract')

old_session="if(url.pathname==='/api/session-signals'){if(!intel?.sessionSignals)return error('Currency outlook is not initialized',503);const technicalAssets=s.technical?.assets??{};const sessions=(intel.sessionSignals.sessions??[]).map((session:any)=>({...session,signals:(session.signals??[]).map((signal:any)=>{const technical=technicalAssets[String(signal.symbol||'').toUpperCase()]??null;const gate=technical?.decisionGate??null;const macroDirection=String(signal.direction||'WAIT').toUpperCase();const technicalAligned=gate?.status==='confirmed'&&((macroDirection==='BUY'&&gate.direction==='bullish')||(macroDirection==='SELL'&&gate.direction==='bearish'));return {...signal,technicalGate:gate?.status??'warming',technicalBias:gate?.direction??'neutral',technicalConfidence:Number(gate?.confidence??0),technicalModel:gate?.model??null,technicalReason:gate?.reason??'Awaiting verified price history.',executionGate:macroDirection==='WAIT'?'NO_DIRECTIONAL_EXECUTION':technicalAligned?'TECHNICAL_CONFIRMATION_PASSED':'AWAIT_TECHNICAL_CONFIRMATION'};})}));return json({...intel.sessionSignals,sessions,economyObservationCount:observations.length,technicalGeneratedAt:s.technical?.generatedAt??null});}"
new_session="if(url.pathname==='/api/session-signals'){if(!intel?.sessionSignals)return error('Currency outlook is not initialized',503);const technicalAssets=s.technical?.assets??{};const applyTechnical=(signal:any)=>{const technical=technicalAssets[String(signal?.symbol||'').toUpperCase()]??null;const gate=technical?.decisionGate??null;const macroDirection=String(signal?.direction||'WAIT').toUpperCase();const technicalAligned=gate?.status==='confirmed'&&((macroDirection==='BUY'&&gate.direction==='bullish')||(macroDirection==='SELL'&&gate.direction==='bearish'));return {...signal,technicalGate:gate?.status??'warming',technicalBias:gate?.direction??'neutral',technicalConfidence:Number(gate?.confidence??0),technicalModel:gate?.model??null,technicalReason:gate?.reason??'Awaiting verified price history.',executionGate:macroDirection==='WAIT'?'NO_DIRECTIONAL_EXECUTION':technicalAligned?'TECHNICAL_CONFIRMATION_PASSED':'AWAIT_TECHNICAL_CONFIRMATION'};};const sessions=(intel.sessionSignals.sessions??[]).map((session:any)=>({...session,signals:(session.signals??[]).map(applyTechnical)}));const rankedOpportunities=(intel.sessionSignals.rankedOpportunities??[]).map(applyTechnical);const rankedBySymbol=new Map(rankedOpportunities.map((item:any)=>[String(item.symbol||'').toUpperCase(),item]));const originalSummary=intel.sessionSignals.decisionSummary??{};const originalTop=originalSummary?.topOpportunity;const topOpportunity=originalTop?{...originalTop,...(rankedBySymbol.get(String(originalTop.symbol||'').toUpperCase())??{})}:rankedOpportunities[0]??null;return json({...intel.sessionSignals,sessions,rankedOpportunities,decisionSummary:{...originalSummary,topOpportunity},economyObservationCount:observations.length,technicalGeneratedAt:s.technical?.generatedAt??null});}"
worker=replace_once(worker,old_session,new_session,'ranked technical gates')

worker=replace_once(worker,
    "if(url.pathname==='/api/super-economist'||url.pathname==='/api/decision-intelligence')return intel?json(intel):error('Decision research is not initialized',503);",
    "if(url.pathname==='/api/super-economist'||url.pathname==='/api/decision-intelligence')return intel?json(publicIntelligence(intel)):error('Decision research is not initialized',503);",
    'public intelligence route')
worker=replace_once(worker,"mode:'external-cloud-run-webhook'","mode:publicMode()",'release state public mode')
worker=replace_once(worker,"stats:{upstreamCalendarRequestsFromCloudflare:0,upstreamFredRequestsFromCloudflare:0,upstreamNewsRequestsFromCloudflare:0,externalWebhookUpdates:s.meta?.updates??0},externalCollector:s.meta??null","stats:{upstreamCalendarRequestsFromApplicationEdge:0,upstreamMacroRequestsFromApplicationEdge:0,upstreamNewsRequestsFromApplicationEdge:0,authenticatedUpdates:s.meta?.updates??0}", 'release state public stats')
worker=replace_once(worker,"cached:true,mode:'google-cloud-run-webhook',calendarSources:['Myfxbook','FXStreet','CNBC']","cached:true,mode:publicMode(),calendarSources:['Primary calendar','Independent calendar cross-check','Market reference feed']",'calendar public mode')
worker=replace_once(worker,"if(url.pathname==='/api/news')return json({items:Array.isArray(intel?.news)?intel.news:[],mode:'google-cloud-run-webhook'});","if(url.pathname==='/api/news')return json({items:Array.isArray(intel?.news)?intel.news:[],mode:publicMode()});",'news public mode')
worker=replace_once(worker,"policy:{importantOnly:true,scope:'persisted Google Cloud data only'}","policy:{importantOnly:true,scope:'persisted primary-source macro data'}",'macro scope')
worker=replace_once(worker,"selection:{cachedOnly:true,source:'Google Cloud webhook',count:series.length}","selection:{cachedOnly:true,source:'verified persisted macro state',count:series.length}",'macro source label')
worker=replace_once(worker,"reason:'All acquisition moved to Google Cloud'","reason:'Acquisition is isolated to the primary data service'",'acquisition reason')
worker=replace_once(worker,"cloudflareAcquisitionDisabled:true","applicationEdgeAcquisitionDisabled:true",'acquisition policy')
worker=replace_once(worker,"if(url.pathname==='/api/acquire')return error('Direct acquisition is disabled on Cloudflare. Google Cloud is the only acquisition tier.',409);","if(url.pathname==='/api/acquire')return error('Direct acquisition is disabled on the application edge. The primary data service owns acquisition.',409);",'acquire error')
write(worker_path,worker)

component_path='src/components/DecisionIntelligence.tsx'
component=read(component_path)
component=replace_once(component,
    "executionGate:'WAIT_EVENT'|'NO_MACRO_EDGE'|'AWAIT_TECHNICAL_CONFIRMATION';",
    "executionGate:'WAIT_EVENT'|'NO_MACRO_EDGE'|'AWAIT_TECHNICAL_CONFIRMATION'|'TECHNICAL_CONFIRMATION_PASSED'|'NO_DIRECTIONAL_EXECUTION';",
    'opportunity gate union')
component=replace_once(component,
    "const gateLabel=(g:Opportunity['executionGate'])=>g==='WAIT_EVENT'?'Event lockout':g==='AWAIT_TECHNICAL_CONFIRMATION'?'Technical confirmation required':'No macro edge';",
    "const gateLabel=(g:Opportunity['executionGate'])=>g==='WAIT_EVENT'?'Event lockout':g==='AWAIT_TECHNICAL_CONFIRMATION'?'Technical confirmation required':g==='TECHNICAL_CONFIRMATION_PASSED'?'Technical confirmation passed':g==='NO_DIRECTIONAL_EXECUTION'?'No directional execution':'No macro edge';",
    'opportunity gate label')
write(component_path,component)
print('Public contract cleanup and technical gate consistency applied successfully.')
