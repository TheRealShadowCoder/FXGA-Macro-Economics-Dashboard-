import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getGeminiHealth,
  getIntelligenceHealth,
  getPromptRegistry,
  streamFxga,
  type FxgaPromptTask,
  type GeminiAnalysis,
  type GeminiChat,
  type GeminiHealth,
  type GeminiMode,
  type GeminiStreamEvent,
  type IntelligenceHealth,
  type PromptRegistry,
} from '../lib/gemini-client';
import { friendlyErrorFromThrown, type FriendlyFxgaError } from '../lib/fxga-errors';
import './GeminiIntelligenceDock.css';

const LIVE_TRADE_REFRESH_MS = 15_000;
const HEALTH_RETRY_MS = 20_000;

type ProgressState = { phase:string; message:string; model?:string; retryAfterSeconds?:number };
type OneClick = { mode:Exclude<GeminiMode,'smc-signal'>; label:string; description:string; task:FxgaPromptTask; question:string };

const MODES:OneClick[] = [
  { mode:'market-brief', label:'Market', description:'Cross-asset prices and technical alignment', task:'cross-asset', question:'Produce the current FXGA cross-asset market brief. Explain the strongest alignments, divergences, technical conflicts, stale evidence and what deserves attention now.' },
  { mode:'macro-brief', label:'Macro', description:'Growth, inflation, labour, rates and conditions', task:'macro-analysis', question:'Produce the current FXGA macro brief. Separate growth, inflation, labour, policy/rates, financial conditions and cross-market implications using only stored evidence.' },
  { mode:'economic-context', label:'Economies', description:'Economic regime and cross-economy context', task:'macro-analysis', question:'Compare the current economic regimes in the stored FXGA evidence. Explain major economy differences, data gaps and what the evidence implies without inventing missing observations.' },
  { mode:'event-research', label:'Event research', description:'Release studies, OOS validation and research maturity', task:'event-study', question:'Explain the current FXGA event-study evidence, sample maturity, horizons, validation status, what is statistically supported and what remains unproven.' },
  { mode:'action-report', label:'Action report', description:'Current evidence behind WAIT / WATCH / PREPARE states', task:'program-chat', question:'Produce the current FXGA action report. Explain the evidence behind WAIT, WATCH or PREPARE states across market, macro, technical, event-risk and stored signals. Do not manufacture a trade.' },
];

const formatTime=(value?:string)=>{
  if(!value)return '—';
  const time=Date.parse(value);
  return Number.isFinite(time)?new Date(time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):value;
};
const formatElapsed=(milliseconds:number)=>`${Math.max(0,milliseconds/1000).toFixed(1)}s`;

const phaseLabel=(phase:string)=>({
  preparing:'Preparing request',
  evidence:'Loading FXGA evidence',
  routing:'Routing to Gemini',
  model:'Connecting to Gemini',
  connected:'Gemini is thinking',
  thinking:'Gemini is thinking',
  typing:'Gemini is typing',
  failover:'Switching Gemini model',
  cooldown:'Model temporarily cooling down',
  cache:'Using cached answer',
  'stale-cache':'Using last verified answer',
  complete:'Response complete',
}[phase]||'FXGA AI is working');

function ActivityDots(){return <span className="gemini-activity-dots" aria-hidden="true"><i></i><i></i><i></i></span>}

function ProgressCard({progress,elapsedMs,compact=false}:{progress:ProgressState;elapsedMs:number;compact?:boolean}){
  const typing=progress.phase==='typing';
  return <div className={`gemini-progress-card ${compact?'compact':''}`} role="status" aria-live="polite" data-ai-phase={progress.phase}>
    <div className="gemini-progress-topline">
      <span className={`gemini-progress-orb ${typing?'rendering':''}`}></span>
      <strong>{phaseLabel(progress.phase)}</strong>
      <ActivityDots/>
      <time>{formatElapsed(elapsedMs)}</time>
    </div>
    <p>{progress.message}{progress.model?` · ${progress.model}`:''}</p>
    <div className="gemini-progress-track"><span></span></div>
    <small>Live server status. Text below is streamed from Gemini as it is generated; no fake completion percentage is used.</small>
  </div>
}

function ErrorCard({value}:{value:FriendlyFxgaError}){
  return <div className="gemini-error-card">
    <strong>{value.title}</strong>
    <p>{value.explanation}</p>
    <small><b>What to do:</b> {value.whatToDo}</small>
    <small><b>Retry:</b> {value.retryable?'Yes, this can usually be tried again.':'No. Fix the input/configuration or wait for the stated quota reset.'}</small>
    {value.retryAfterSeconds!=null&&<small><b>Retry after:</b> about {value.retryAfterSeconds} seconds</small>}
    <code>{value.code}{value.technical?.httpStatus?` · HTTP ${value.technical.httpStatus}`:''}</code>
    <a href="/fxga-error-guide.html" target="_blank" rel="noreferrer">Open the full FXGA error guide ↗</a>
  </div>
}

export function GeminiIntelligenceDock(){
  const [open,setOpen]=useState(false);
  const [health,setHealth]=useState<GeminiHealth|null>(null);
  const [intelligenceHealth,setIntelligenceHealth]=useState<IntelligenceHealth|null>(null);
  const [registry,setRegistry]=useState<PromptRegistry|null>(null);
  const [mode,setMode]=useState<Exclude<GeminiMode,'smc-signal'>>('action-report');
  const [analysis,setAnalysis]=useState<GeminiAnalysis|null>(null);
  const [analysisText,setAnalysisText]=useState('');
  const [analysisProgress,setAnalysisProgress]=useState<ProgressState>({phase:'preparing',message:'Ready'});
  const [analysisElapsedMs,setAnalysisElapsedMs]=useState(0);
  const [chat,setChat]=useState<GeminiChat|null>(null);
  const [chatText,setChatText]=useState('');
  const [chatProgress,setChatProgress]=useState<ProgressState>({phase:'preparing',message:'Ready'});
  const [chatElapsedMs,setChatElapsedMs]=useState(0);
  const [question,setQuestion]=useState('');
  const [task,setTask]=useState<'auto'|FxgaPromptTask>('auto');
  const [loading,setLoading]=useState(false);
  const [chatLoading,setChatLoading]=useState(false);
  const [healthChecking,setHealthChecking]=useState(true);
  const [healthError,setHealthError]=useState('');
  const [error,setError]=useState<FriendlyFxgaError|null>(null);

  const refreshHealth=useCallback(async(signal?:AbortSignal)=>{
    setHealthChecking(true);
    const [healthResult,intelligenceResult,registryResult]=await Promise.allSettled([
      getGeminiHealth(signal),getIntelligenceHealth(signal),getPromptRegistry(signal),
    ]);
    if(healthResult.status==='fulfilled')setHealth(healthResult.value);
    if(intelligenceResult.status==='fulfilled')setIntelligenceHealth(intelligenceResult.value);
    if(registryResult.status==='fulfilled')setRegistry(registryResult.value);
    const anyHealth=healthResult.status==='fulfilled'||intelligenceResult.status==='fulfilled';
    setHealthError(anyHealth?'':'Gemini health is temporarily unreachable. Questions can still be sent directly to Google Cloud.');
    setHealthChecking(false);
  },[]);

  useEffect(()=>{const controller=new AbortController();void refreshHealth(controller.signal);return()=>controller.abort()},[refreshHealth]);

  const configured=health?.configured===true||intelligenceHealth?.configured===true;
  const healthKnown=health!==null||intelligenceHealth!==null;
  const selected=useMemo(()=>MODES.find(item=>item.mode===mode)??MODES[0],[mode]);
  const liveTradeTask=task!=='auto'&&String(task).endsWith('trade-management-live');
  const busy=loading||chatLoading;

  useEffect(()=>{
    if(!open||configured)return;
    const timer=window.setInterval(()=>void refreshHealth(),HEALTH_RETRY_MS);
    return()=>window.clearInterval(timer);
  },[open,configured,refreshHealth]);

  useEffect(()=>{
    if(!chatLoading)return;
    const started=Date.now()-chatElapsedMs;
    const timer=window.setInterval(()=>setChatElapsedMs(Date.now()-started),100);
    return()=>window.clearInterval(timer);
  },[chatLoading]);

  useEffect(()=>{
    if(!loading)return;
    const started=Date.now()-analysisElapsedMs;
    const timer=window.setInterval(()=>setAnalysisElapsedMs(Date.now()-started),100);
    return()=>window.clearInterval(timer);
  },[loading]);

  const promptGroups=useMemo(()=>{
    const groups=new Map<string,PromptRegistry['prompts']>();
    for(const item of registry?.prompts??[]){
      if(item.id==='live-intelligence-report')continue;
      const category=item.category||'other';
      if(!groups.has(category))groups.set(category,[]);
      groups.get(category)!.push(item);
    }
    return[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([category,items])=>({category,items:[...items].sort((a,b)=>a.label.localeCompare(b.label))}));
  },[registry]);

  const applyStreamEvent=(event:GeminiStreamEvent,target:'chat'|'analysis')=>{
    if(event.type==='status'){
      const next={phase:event.phase,message:event.message,model:event.model,retryAfterSeconds:event.retryAfterSeconds};
      target==='chat'?setChatProgress(next):setAnalysisProgress(next);
    }else if(event.type==='delta'){
      target==='chat'?setChatText(value=>value+event.text):setAnalysisText(value=>value+event.text);
    }
  };

  async function run(nextMode=mode){
    if(busy)return;
    const config=MODES.find(item=>item.mode===nextMode)??MODES[0];
    setMode(nextMode);setLoading(true);setAnalysis(null);setAnalysisText('');setAnalysisElapsedMs(0);setError(null);
    setAnalysisProgress({phase:'preparing',message:'Starting one-click FXGA intelligence'});
    try{
      const result=await streamFxga(config.question,{task:config.task,onEvent:event=>applyStreamEvent(event,'analysis')});
      setAnalysis({schema:'fxga.gemini.analysis.v1',mode:nextMode,label:config.label,model:result.model,output:result.answer,contextHash:result.contextHash,createdAt:result.createdAt,cached:result.cached,coalesced:result.coalesced,policy:result.policy});
      if(!analysisText)setAnalysisText(result.answer);
      setAnalysisProgress({phase:'complete',message:'Response complete',model:result.model});
      if(!configured)void refreshHealth();
    }catch(caught){
      setAnalysis(null);setAnalysisText('');setError(friendlyErrorFromThrown(caught));void refreshHealth();
    }finally{setLoading(false)}
  }

  async function ask(){
    const clean=question.trim();
    if(!clean||busy)return;
    setChatLoading(true);setChat(null);setChatText('');setChatElapsedMs(0);setError(null);
    setChatProgress({phase:'preparing',message:'Starting FXGA evidence request'});
    try{
      const result=await streamFxga(clean,{...(task==='auto'?{}:{task}),onEvent:event=>applyStreamEvent(event,'chat')});
      setChat(result);
      setChatText(current=>current||result.answer);
      setChatProgress({phase:'complete',message:'Response complete',model:result.model});
      if(!configured)void refreshHealth();
    }catch(caught){
      setChat(null);setChatText('');setError(friendlyErrorFromThrown(caught));void refreshHealth();
    }finally{setChatLoading(false)}
  }

  useEffect(()=>{
    if(!open||!liveTradeTask||!question.trim()||busy)return;
    const timer=window.setInterval(()=>void ask(),LIVE_TRADE_REFRESH_MS);
    return()=>window.clearInterval(timer);
  },[open,liveTradeTask,task,question,busy]);

  const statusText=healthChecking&&!healthKnown
    ?'Checking Google Gemini configuration…'
    :configured
      ?`${intelligenceHealth?.model||health?.model||'Gemini'} connected · ${intelligenceHealth?.promptCount||registry?.prompts?.length||0} task prompts · streaming enabled · no FXGA hourly/daily cap`
      :healthKnown
        ?'Gemini credential is not active yet · server recovery is enabled'
        :'Gemini health unavailable · direct Google Cloud retry remains available';

  const chatButtonText=chatLoading?phaseLabel(chatProgress.phase):'Ask FXGA';

  return <div className={`gemini-dock ${open?'open':''}`}>
    <button className="gemini-dock-toggle" onClick={()=>setOpen(value=>!value)} aria-expanded={open}>
      <span className="gemini-spark">✦</span><span>Ask FXGA AI</span>
      {busy?<ActivityDots/>:<i className={configured?'online':'offline'}></i>}
    </button>

    {open&&<section className="gemini-dock-panel" aria-label="FXGA Gemini intelligence">
      <header><div><small>FXGA · Google Gemini</small><h3>Evidence Intelligence</h3></div><button onClick={()=>setOpen(false)} aria-label="Close Gemini panel">×</button></header>
      <div className="gemini-status"><i className={configured?'online':'offline'}></i><span>{statusText}</span>{!configured&&<button type="button" onClick={()=>void refreshHealth()} disabled={healthChecking}>{healthChecking?'Checking…':'Retry'}</button>}</div>
      {healthError&&<div className="gemini-live-note">{healthError}</div>}

      <div className="gemini-chatbox">
        <div className="gemini-chat-head"><strong>Ask anything about the program</strong><a href="/fxga-intelligence-live.html" target="_blank" rel="noreferrer">Open live intelligence ↗</a></div>
        <textarea value={question} onChange={event=>setQuestion(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey))void ask()}} placeholder="Examples: What are today's setups? Find a scalp buy entry. Manage this day trade live. Explain the strongest measured evidence and invalidation."/>
        <div className="gemini-chat-actions">
          <select value={task} onChange={event=>setTask(event.target.value as 'auto'|FxgaPromptTask)} aria-label="FXGA AI task">
            <option value="auto">Auto-select best advanced prompt</option>
            {promptGroups.map(group=><optgroup key={group.category} label={group.category.toUpperCase()}>{group.items.map(item=><option key={item.id} value={item.id}>{item.label}{item.realtime?' · LIVE':''}</option>)}</optgroup>)}
          </select>
          <button onClick={()=>void ask()} disabled={busy||!question.trim()}>{chatButtonText}</button>
          {liveTradeTask&&<small className="gemini-live-note">LIVE · re-checks current evidence every 15 seconds after the previous stream finishes</small>}
        </div>

        {chatLoading&&<ProgressCard progress={chatProgress} elapsedMs={chatElapsedMs} compact/>}
        {(chatLoading||chat)&&<div className={`gemini-chat-answer ${chatLoading?'typing':''}`} data-ai-streaming={chatLoading?'true':'false'}>
          <div className="gemini-output-meta">
            <span>{chat?.label||task==='auto'?'FXGA intelligence':String(task)}</span>
            <span>{chat?.model||chatProgress.model||'routing'}</span>
            <span>{chatLoading?'live stream':chat?.cached?'cached':'fresh'}</span>
            <span>{chat?formatTime(chat.createdAt):formatElapsed(chatElapsedMs)}</span>
            {chatLoading&&<span className="gemini-typing-label">streaming</span>}
          </div>
          <div className="gemini-output-text">{chatText}{chatLoading&&<span className="gemini-typing-caret" aria-hidden="true"></span>}</div>
          <footer>{chatLoading?'Live provider stream · text appears as Gemini sends it.':`Evidence: ${(chat?.evidenceDomains??[]).join(' · ')||'current FXGA evidence'} · ${chat?.policy||'Evidence-grounded analysis only.'}`}</footer>
        </div>}
      </div>

      <div className="gemini-mode-title"><strong>One-click intelligence</strong><small>All five now use the same resilient streaming model pool</small></div>
      <div className="gemini-mode-grid">{MODES.map(item=><button key={item.mode} className={mode===item.mode?'active':''} onClick={()=>void run(item.mode)} disabled={busy}><strong>{item.label}</strong><small>{item.description}</small></button>)}</div>

      {error&&<ErrorCard value={error}/>} 
      <div className="gemini-output">
        {loading&&<ProgressCard progress={analysisProgress} elapsedMs={analysisElapsedMs}/>} 
        {!loading&&!error&&!analysis&&!analysisText&&<div className="gemini-empty"><strong>{selected.label}</strong><p>Select a one-click intelligence mode or ask the chatbot. Both paths use the same Google Cloud streaming gateway, model failover and Firestore evidence cache.</p></div>}
        {(loading||analysis||analysisText)&&<>
          <div className="gemini-output-meta"><span>{analysis?.label||selected.label}</span><span>{analysis?.model||analysisProgress.model||'routing'}</span><span>{loading?'live stream':analysis?.cached?'cached':'fresh'}</span><span>{analysis?formatTime(analysis.createdAt):formatElapsed(analysisElapsedMs)}</span>{loading&&<span className="gemini-typing-label">streaming</span>}</div>
          <div className="gemini-output-text">{analysisText||analysis?.output||''}{loading&&<span className="gemini-typing-caret" aria-hidden="true"></span>}</div>
          <footer>{loading?'Live provider stream · thinking/model-routing status is shown above.':analysis?.policy||'Evidence-grounded analysis only.'}</footer>
        </>}
      </div>
    </section>}
  </div>
}
