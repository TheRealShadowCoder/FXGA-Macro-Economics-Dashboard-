from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]

def patch(path, transforms):
    file=ROOT/path
    text=file.read_text(encoding='utf-8')
    original=text
    for old,new in transforms:
        if old in text:
            text=text.replace(old,new,1)
        elif new not in text:
            raise RuntimeError(f'{path}: patch anchor not found: {old[:100]!r}')
    if text!=original:
        file.write_text(text,encoding='utf-8')
        print('patched',path)
    else:
        print('unchanged',path)

patch(Path('src/App.tsx'),[
("import { MarketsView } from './components/MarketsView';","import { MarketsView } from './components/MarketsView';\nimport { ResearchView } from './components/ResearchView';"),
("type View = 'overview' | 'markets' | 'analysis' | 'signals' | 'calendar' | 'indicators' | 'universe' | 'acquisition' | 'news' | 'sources';","type View = 'overview' | 'markets' | 'analysis' | 'research' | 'signals' | 'calendar' | 'indicators' | 'universe' | 'acquisition' | 'news' | 'sources';"),
("  { id: 'overview', label: 'Macro Pulse' },","  { id: 'overview', label: 'Macro Dashboard' },"),
("  { id: 'analysis', label: 'Macro Analysis' },\n  { id: 'signals', label: 'Session Signals' },","  { id: 'analysis', label: 'Macro Analysis' },\n  { id: 'research', label: 'Research & Risk' },\n  { id: 'signals', label: 'Currency Outlook' },"),
("  { id: 'universe', label: 'Important FRED Data' },","  { id: 'universe', label: 'Macro Data Library' },"),
("  { id: 'acquisition', label: 'Acquisition Engine' },","  { id: 'acquisition', label: 'Data Operations' },"),
("  { id: 'sources', label: 'Source Health' },","  { id: 'sources', label: 'Data Coverage' },"),
("          if (payload.type === 'source-update' || payload.type === 'google-cloud-update') {","          if (payload.type === 'source-update' || payload.type === 'google-cloud-update' || payload.type === 'data-update') {"),
("            const source = payload.sourceId || payload.updateType || 'Google Cloud';","            const source = payload.sourceId || payload.updateType || 'Data network';"),
("        <div className=\"brand\"><div className=\"brand-mark\">FX</div><div><strong>FXGA</strong><span>Macro Intelligence</span></div></div>","        <div className=\"brand\"><div className=\"brand-mark\"></div><div><strong>FX Global Avengers</strong><span>Trading Academy · Macro Intelligence</span></div></div>"),
("        <div className=\"sidebar-foot\"><span className={`system-light ${liveStatus}`}></span><div><strong>Collection Engine</strong><small>{liveSources}/{configuredSources || '—'} sources live · WS {liveStatus}</small></div></div>","        <div className=\"sidebar-foot\"><span className={`system-light ${liveStatus}`}></span><div><strong>Data Network</strong><small>{liveSources}/{configuredSources || '—'} sources available · Live {liveStatus}</small></div></div>"),
("<p>Important official data and scraped calendar intelligence are normalized into the FXGA decision pipeline.</p>","<p>Official economic data, release history and cross-asset intelligence are normalized into a consistent decision framework.</p>"),
("<span>CNBC assets</span>","<span>Cross-asset quotes</span>"),
("<div className=\"pipeline-card\"><span className=\"eyebrow\">FXGA Causal Chain</span>","<div className=\"pipeline-card\"><span className=\"eyebrow\">Macro Transmission</span>"),
("        {view === 'analysis' && <AnalysisView data={analysis} loading={analysisLoading} error={analysisError} />}\n        {view === 'signals' && <SignalsView data={signals} loading={signalsLoading} error={signalsError} />}","        {view === 'analysis' && <AnalysisView data={analysis} loading={analysisLoading} error={analysisError} />}\n        {view === 'research' && <ResearchView />}\n        {view === 'signals' && <SignalsView data={signals} loading={signalsLoading} error={signalsError} />}"),
("Loading important FRED indicators…","Loading important macro indicators…"),
("Decision Relevant FRED Set","Decision Relevant Macro Library"),
("Fetching live FRED observations…","Fetching live macro observations…"),
("No persisted calendar events are currently available from the scraped calendar consensus.","No persisted calendar events are currently available in the selected window."),
("<footer>Generated {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : '—'} · FXGA Macro Intelligence</footer>","<footer>Generated {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : '—'} · FX Global Avengers Trading Academy</footer>"),
])

patch(Path('src/components/AcquisitionView.tsx'),[
('Loading Google Cloud ingestion state…','Loading data operations…'),
('FXGA Google Cloud Ingestion Matrix','Institutional Data Operations'),
('FRED, calendars, official central-bank/statistics feeds, browser fallback and intelligence execute in Google Cloud. Cloudflare serves the signed snapshots only.','Economic data, calendars, official publications and market feeds are collected by the primary data network and delivered through authenticated live updates.'),
('Google source groups healthy','Source groups healthy'),
('Signed Webhook Transport','Secure Live Data Channel'),
('Changed Google state is pushed through authenticated webhooks and then broadcast through the dashboard WebSocket.','Changed source state is delivered through authenticated live updates and broadcast to the dashboard.'),
('Waiting for the next Google Cloud state update.','Waiting for the next verified data update.'),
('Google collection degraded','Data collection degraded'),
('Google Cloud Sources','Primary Data Sources'),
('Execution: Google Cloud','Collection: Primary'),
('Google acquisition: yes','Primary acquisition: active'),
('Google intelligence: yes','Research engine: active'),
('signed webhooks: yes','authenticated updates: active'),
('Cloudflare acquisition: no','Edge acquisition: disabled'),
('Cloudflare browser: no','Edge browser collection: disabled'),
('Cloudflare FRED/news/calendar requests: no','Edge upstream collection: disabled'),
('Architecture Contract','Operating Controls'),
])

patch(Path('src/components/DecisionIntelligence.tsx'),[
('FXGA Critical Intelligence Matrix','Decision Intelligence'),
('Explicitly unavailable until Google-side feeds are connected:','Unavailable until verified source feeds are connected:'),
])

patch(Path('cloud-run-collector/src/super-economist.js'),[
("import { buildDecisionMatrix, eventEconomy, orientation as eventOrientation } from './intelligence-matrix.js';","import { buildDecisionMatrix, eventEconomy, orientation as eventOrientation } from './intelligence-matrix.js';\nimport { buildInstitutionalResearch } from './institutional-research.js';"),
("description:`Google Cloud FXGA 9705 ${d.label} family-collapse score`","description:`${d.label} evidence-family score`"),
("methodology:{scoreRange:'-100 to +100',principle:'FXGA 9705 independent-family collapse on Google Cloud',caution:'Unavailable or stale methods receive zero or near-zero availability. Registry size is not treated as independent evidence.'}","methodology:{scoreRange:'-100 to +100',principle:'Independent evidence-family aggregation with availability weighting',caution:'Unavailable or stale evidence receives zero or near-zero availability. Registry size is not treated as independent evidence.'}"),
("methodology:'Google Cloud FXGA 9705 release impulse + family-collapsed baseline'","methodology:'Release impulse combined with the family-collapsed macro baseline'"),
("note:'Execution is family-collapsed. The 9,705-row universe is represented by its 150 documented families and exact family method counts; source-native event logic S44-S50 is retained explicitly.'","note:'Execution is family-collapsed so related calculations cannot create duplicate evidence. Source-native event logic is retained explicitly.'"),
("const special=specialEventModels(economies,decision),impact=releaseImpact(macroAnalysis,events),registry=registrySummary(context),activeFamilyCodes=new Set(economies.flatMap(e=>e.familyScores.filter(f=>f.independentWeight>0).map(f=>f.code))),topFamilies=economies.map(e=>({economy:e.id,families:e.familyScores.filter(f=>f.independentWeight>0).slice(0,30).map(compactFamily)}));","const special=specialEventModels(economies,decision),impact=releaseImpact(macroAnalysis,events),registry=registrySummary(context),activeFamilyCodes=new Set(economies.flatMap(e=>e.familyScores.filter(f=>f.independentWeight>0).map(f=>f.code))),topFamilies=economies.map(e=>({economy:e.id,families:e.familyScores.filter(f=>f.independentWeight>0).slice(0,30).map(compactFamily)}));\n  const research=buildInstitutionalResearch({observations,events,market:Array.isArray(marketData)?marketData:(marketData?.assets||[]),news,economyAnalysis,currencyStates:decision?.currencyStates||[],opportunities:decision?.rankedOpportunities||[]});"),
("return {schemaVersion:4,generatedAt:new Date().toISOString(),engine:'FXGA 9705 Super Economist + Critical Intelligence Matrix',executionLocation:'Google Cloud Run',pipeline:","return {schemaVersion:4,generatedAt:new Date().toISOString(),engine:'Institutional Macro Research Engine',executionLocation:'Google Cloud Run',pipeline:"),
("registry,coverage,economyAnalysis,macroAnalysis,sessionSignals:decision,decisionIntelligence:decision","registry,coverage,economyAnalysis,macroAnalysis,sessionSignals:{...decision,researchSummary:{dataQuality:research.dataQuality,risk:research.risk,releaseAnalytics:research.releaseAnalytics}},decisionIntelligence:decision,research"),
("caution:'Probabilistic research framework. Real-time market, order-book, options and alternative-data families remain unavailable until Google-side feeds exist; they receive zero availability and cannot create false confidence.'","caution:'Probabilistic research framework. Evidence families without verified source data receive zero availability and cannot create false confidence.'"),
("const economyAnalysis={generatedAt:new Date().toISOString(),methodology:'FXGA 9705 independent-family collapse -> eligible-evidence confidence calibration -> economic actual -> central-bank reaction -> release/narrative matrix -> BUY/SELL/WAIT; executed on Google Cloud.'","const economyAnalysis={generatedAt:new Date().toISOString(),methodology:'Independent evidence-family aggregation -> eligible-evidence confidence calibration -> economic actual -> central-bank reaction -> release/narrative matrix -> BUY/SELL/WAIT.'"),
])

patch(Path('cloud-run-collector/src/super-runtime.js'),[
("collectionWarning:'Latest Google refresh failed; retained last-known-good observation.'","collectionWarning:'Latest refresh failed; retained last-known-good observation.'"),
("description:'Google Cloud FXGA important macro family'","description:'Important macro family'"),
("scope:'Google Cloud collector only'","scope:'Primary macro collector'"),
("const [calendar,macro,universe]=await Promise.all([get('calendar'),get('macro'),get('fred-universe')]),events=calendar?.payload?.events||[],observations=macro?.payload?.observations||[],news=await ensureNews(forceNews),skills=await reliability();","const [calendar,macro,universe,market]=await Promise.all([get('calendar'),get('macro'),get('fred-universe'),get('market')]),events=calendar?.payload?.events||[],observations=macro?.payload?.observations||[],marketData=market?.payload?.assets||[],news=await ensureNews(forceNews),skills=await reliability();"),
("let engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills});const scored=await scoreFrozen(events,skills);if(scored)engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills});","let engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData});const scored=await scoreFrozen(events,skills);if(scored)engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData});"),
])

patch(Path('cloud-run-collector/src/server-v2.js'),[
("if (maxImportance>=3) return [0,5,15,30,60,120,300];\n  if (maxImportance===2) return [0,15,60,180];\n  return [0,60,180];","if (maxImportance>=3) return [0,60,300,900,3600,14400];\n  if (maxImportance===2) return [0,300,900,3600];\n  return [0,900,3600];"),
])

patch(Path('cloud-run-collector/src/launcher.js'),[
("refreshSuperEconomist({forceNews}).then(x=>console.log('FXGA 9705 intelligence refresh',JSON.stringify({trigger:url.pathname,...x}))).catch(e=>console.error('FXGA 9705 intelligence refresh failed',e));","if(url.pathname==='/release-check')fetch(`http://127.0.0.1:${internalPort}/market-sync`,{method:'POST'}).catch(e=>console.warn('Release-aligned market snapshot deferred',String(e?.message||e)));\n      refreshSuperEconomist({forceNews}).then(x=>console.log('Intelligence refresh',JSON.stringify({trigger:url.pathname,...x}))).catch(e=>console.error('Intelligence refresh failed',e));"),
("server.listen(publicPort,()=>console.log(`FXGA Google Cloud gateway v3 on :${publicPort}; collector v2 internal :${internalPort}`));","server.listen(publicPort,()=>console.log(`Macro research gateway on :${publicPort}; collector internal :${internalPort}`));"),
])

patch(Path('cloud-run-collector/package.json'),[
("node --check src/global-fred.js && node --check src/cnbc-market.js && node --check src/server-v2.js","node --check src/global-fred.js && node --check src/cnbc-market.js && node --check src/institutional-research.js && node --check src/server-v2.js"),
])

worker=ROOT/'worker/index-v3.ts'
text=worker.read_text(encoding='utf-8')
original=text
text=text.replace("source:typeof item?.source==='string'?item.source:'Google Cloud'","source:typeof item?.source==='string'?item.source:'Primary data network'")
source_re=re.compile(r"const SOURCE_VIEW=\[.*?\] as const;",re.S)
source_new="const SOURCE_VIEW=[{id:'macro-primary',name:'FRED Economic Data',category:'Macro Data API',region:'Global',status:'live',note:'Primary macroeconomic series with last-good retention and freshness controls.'},{id:'calendar-primary',name:'Global Economic Calendar',category:'Economic Calendar',region:'Global',status:'live',note:'Economic releases with actual, consensus, previous, revision and currency-bias history.'},{id:'calendar-crosscheck',name:'Calendar Cross Check',category:'Economic Calendar',region:'Global',status:'live',note:'Independent calendar source used for reconciliation and release validation.'},{id:'official-publications',name:'Official Central Bank & Statistics Feeds',category:'Official Publications',region:'Global',status:'live',note:'Primary-source statements, releases and statistical publications.'},{id:'decision-research',name:'Decision Research Engine',category:'Research & Risk',region:'Global',status:'live',note:'Macro, event, risk, scenario and probability research used by the dashboard.'}] as const;"
if source_re.search(text): text=source_re.sub(source_new,text,count=1)
text=text.replace("this.broadcast({type:'google-cloud-update',updateType:type,timestamp:meta.lastWebhookAt})","this.broadcast({type:'data-update',updateType:type,timestamp:meta.lastWebhookAt})")
text=text.replace("channel:'fxga-google-webhook-live'","channel:'macro-intelligence-live'")
text=text.replace("error('Google intelligence snapshot is not initialized',503)","error('Analysis snapshot is not initialized',503)")
text=text.replace("error('Google economy analysis is not initialized',503)","error('Economy analysis is not initialized',503)")
text=text.replace("error('Google session intelligence is not initialized',503)","error('Currency outlook is not initialized',503)")
text=text.replace("error('Google release impact is not initialized',503)","error('Release impact is not initialized',503)")
text=text.replace("error('Google Super Economist is not initialized',503)","error('Decision research is not initialized',503)")
route="if(url.pathname==='/api/super-economist'||url.pathname==='/api/decision-intelligence')return intel?json(intel):error('Decision research is not initialized',503);"
addition=route+"\n      if(url.pathname==='/api/research')return intel?.research?json(intel.research):error('Research snapshot is not initialized',503);\n      if(url.pathname==='/api/data-quality')return intel?.research?.dataQuality?json(intel.research.dataQuality):error('Data-quality research is not initialized',503);\n      if(url.pathname==='/api/scenarios')return intel?.research?.scenarios?json({generatedAt:intel.research.generatedAt,scenarios:intel.research.scenarios}):error('Scenario research is not initialized',503);\n      if(url.pathname==='/api/release-analytics')return intel?.research?.releaseAnalytics?json(intel.research.releaseAnalytics):error('Release analytics are not initialized',503);"
if route in text and "/api/research'" not in text:text=text.replace(route,addition,1)
if text!=original:
    worker.write_text(text,encoding='utf-8');print('patched worker/index-v3.ts')
else: print('unchanged worker/index-v3.ts')

print('institutional research upgrade patch complete')
