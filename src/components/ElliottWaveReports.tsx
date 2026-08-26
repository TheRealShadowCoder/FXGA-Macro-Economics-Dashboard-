import { useCallback, useEffect, useMemo, useState } from 'react';
import './ElliottWaveReports.css';

const ALL_MT5_TIMEFRAMES=['M1','M2','M3','M4','M5','M6','M10','M12','M15','M20','M30','H1','H2','H3','H4','H6','H8','H12','D1','W1','MN1'];
const API_BASE=String((import.meta as ImportMeta & { env?: Record<string,string|undefined> }).env?.VITE_GOOGLE_CLOUD_API_BASE||'').trim().replace(/\/+$/,'');

type BridgeState={online:boolean;lastSeen:string|null;terminalId:string|null};
type ElliottReport={id:string;symbol:string;timeframes:string[];pageCount:number;createdAt:string|null;completedAt:string|null;fileName:string;pdfUrl:string};
type ElliottJob={id:string;status:string;symbol:string;timeframes:string[];uploadedTimeframes:string[];createdAt:string|null;updatedAt:string|null;error:string|null;reportId:string|null};
type ElliottDecision={
  status:'TRADE_SETUP'|'WAIT'|'NO_TRADE';direction:'BUY'|'SELL'|'NEUTRAL';confidence:number;
  entry:{type:string;price:number|null;zoneLow:number|null;zoneHigh:number|null;trigger:string};
  stopLoss:{price:number|null;basis:string};
  takeProfits:Array<{label:string;price:number|null;basis:string}>;
  elliott:{primaryCount:string;currentWave:string;higherTimeframeBias:string;microStructure:string;invalidation:number|null;alternateCount:string};
  riskReward:{tp1:number|null;tp2:number|null;tp3:number|null};indicatorPlanConsistency:boolean;
  deviationsFromIndicator:string[];evidenceSummary:string[];conflicts:string[];invalidationConditions:string[];missingEvidence:string[];summary:string;
};
type ElliottAiAnalysis={id:string;jobId:string;symbol:string;status:string;aiState:string;model:string|null;promptVersion:string;evidenceCount:number;evidenceExpected:number;generatedAt:string|null;updatedAt:string|null;error:string|null;decision:ElliottDecision|null};
type ElliottAiState={jobId:string;reportReady:boolean;evidenceCount:number;evidenceExpected:number;analysis:ElliottAiAnalysis|null};

function formatTime(value:string|null){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString();}
function formatPrice(value:number|null|undefined){return Number.isFinite(Number(value))&&Number(value)>0?Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:5}):'—';}
function formatRR(value:number|null|undefined){return Number.isFinite(Number(value))&&Number(value)>0?`${Number(value).toFixed(2)}R`:'—';}
function apiUrl(path:string){return API_BASE?`${API_BASE}${path}`:path;}
function absolutePdfUrl(path:string){return API_BASE?`${API_BASE}${path}`:new URL(path,window.location.origin).toString();}

export function ElliottWaveReports(){
  const [symbol,setSymbol]=useState('XAUUSD');
  const [bridge,setBridge]=useState<BridgeState>({online:false,lastSeen:null,terminalId:null});
  const [reports,setReports]=useState<ElliottReport[]>([]);
  const [activeJob,setActiveJob]=useState<ElliottJob|null>(null);
  const [selected,setSelected]=useState<ElliottReport|null>(null);
  const [aiState,setAiState]=useState<ElliottAiState|null>(null);
  const [aiLoading,setAiLoading]=useState(false);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');

  const progress=useMemo(()=>activeJob?.timeframes?.length?Math.round((activeJob.uploadedTimeframes?.length||0)/activeJob.timeframes.length*100):0,[activeJob]);
  const decision=aiState?.analysis?.decision||null;

  const refreshReports=useCallback(async()=>{
    const response=await fetch(apiUrl('/api/elliott-reports'),{headers:{Accept:'application/json','Cache-Control':'no-cache'}});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||`Reports API ${response.status}`);
    setReports(Array.isArray(payload.reports)?payload.reports:[]);
    setBridge(payload.bridge||{online:false,lastSeen:null,terminalId:null});
  },[]);

  const refreshAi=useCallback(async(jobId:string)=>{
    const response=await fetch(apiUrl(`/api/elliott-ai/jobs/${encodeURIComponent(jobId)}`),{headers:{Accept:'application/json','Cache-Control':'no-cache'}});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||`Elliott AI status ${response.status}`);
    setAiState(payload as ElliottAiState);
    return payload as ElliottAiState;
  },[]);

  const runAi=useCallback(async(jobId:string)=>{
    if(!jobId||aiLoading)return;
    setAiLoading(true);setMessage('Gemini is reviewing the 21 chart screenshots and the indicator evidence…');
    try{
      const response=await fetch(apiUrl(`/api/elliott-ai/analyze?jobId=${encodeURIComponent(jobId)}`),{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:'{}'});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||`Elliott AI ${response.status}`);
      await refreshAi(jobId);
      const d=payload.analysis?.decision as ElliottDecision|undefined;
      setMessage(d?`AI Elliott decision ready: ${d.status.replace('_',' ')}${d.direction!=='NEUTRAL'?` · ${d.direction}`:''}.`:'AI Elliott analysis is ready.');
    }catch(error){setMessage(String((error as Error).message||error));await refreshAi(jobId).catch(()=>{});}finally{setAiLoading(false);}
  },[aiLoading,refreshAi]);

  useEffect(()=>{refreshReports().catch(error=>setMessage(String(error.message||error)));const timer=window.setInterval(()=>refreshReports().catch(()=>{}),10000);return()=>window.clearInterval(timer);},[refreshReports]);

  useEffect(()=>{
    if(!activeJob||['READY','FAILED'].includes(activeJob.status))return;
    let cancelled=false;
    const poll=async()=>{
      try{
        const response=await fetch(apiUrl(`/api/elliott-reports/jobs/${encodeURIComponent(activeJob.id)}`),{headers:{Accept:'application/json','Cache-Control':'no-cache'}});
        const payload=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(payload.error||`Job API ${response.status}`);
        if(cancelled)return;
        const job=payload.job as ElliottJob;setActiveJob(job);
        refreshAi(job.id).catch(()=>{});
        if(job.status==='READY'){
          setMessage('Multi-timeframe Elliott PDF is ready. Starting AI evidence analysis…');
          await refreshReports();
        }else if(job.status==='FAILED')setMessage(job.error||'MT5 report capture failed.');
      }catch(error){if(!cancelled)setMessage(String((error as Error).message||error));}
    };
    poll();const timer=window.setInterval(poll,2000);return()=>{cancelled=true;window.clearInterval(timer);};
  },[activeJob?.id,activeJob?.status,refreshAi,refreshReports]);

  useEffect(()=>{
    if(activeJob?.status!=='READY'||aiLoading)return;
    let cancelled=false;
    refreshAi(activeJob.id).then(state=>{if(!cancelled&&!state.analysis)runAi(activeJob.id);}).catch(error=>{if(!cancelled)setMessage(String(error.message||error));});
    return()=>{cancelled=true;};
  },[activeJob?.id,activeJob?.status,aiLoading,refreshAi,runAi]);

  useEffect(()=>{
    if(!selected)return;
    refreshAi(selected.id).catch(()=>setAiState(null));
  },[selected?.id,refreshAi]);

  const analyze=async()=>{
    const clean=String(symbol||'XAUUSD').trim().toUpperCase().replace(/[^A-Z0-9._-]/g,'').slice(0,32)||'XAUUSD';
    setSymbol(clean);setLoading(true);setAiState(null);setMessage('Sending an on-demand evidence capture job to MT5…');
    try{
      const response=await fetch(apiUrl('/api/elliott-reports/request'),{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({symbol:clean,timeframes:ALL_MT5_TIMEFRAMES})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||`Analyze request ${response.status}`);
      setActiveJob(payload.job);setMessage(bridge.online?'MT5 accepted queue polling. It will capture screenshots and structured Elliott evidence for all 21 timeframes.':'Analyze job queued. MT5 is currently offline; capture will start when EA Bridge reconnects.');
    }catch(error){setMessage(String((error as Error).message||error));}finally{setLoading(false);}
  };

  const selectReport=(report:ElliottReport)=>{setSelected(report);setAiState(null);refreshAi(report.id).catch(()=>{});};

  return <section className="ewr-shell">
    <div className="ewr-head">
      <div><span className="eyebrow">MT5 Elliott Wave Evidence Bridge</span><h2>Elliott Wave AI Trade Intelligence</h2><p>One Analyze request captures all 21 MT5 charts plus strict non-repainting indicator evidence, builds the private PDF, and asks Gemini to audit the Elliott structure before returning executable levels or a WAIT / NO TRADE decision.</p></div>
      <span className={`ewr-bridge ${bridge.online?'online':'offline'}`}><i></i>{bridge.online?'MT5 bridge online':'MT5 bridge offline'}</span>
    </div>

    <div className="ewr-control panel">
      <label><span>Symbol</span><input value={symbol} onChange={event=>setSymbol(event.target.value.toUpperCase())} onKeyDown={event=>{if(event.key==='Enter'&&!loading)analyze();}} placeholder="XAUUSD" maxLength={32}/></label>
      <div className="ewr-tf"><span>Evidence scope</span><strong>21 screenshots + indicator state</strong><small>{ALL_MT5_TIMEFRAMES.join(' · ')}</small></div>
      <button className="ewr-analyze" type="button" disabled={loading||Boolean(activeJob&&!['READY','FAILED'].includes(activeJob.status))} onClick={analyze}>{loading?'Queuing…':activeJob&&!['READY','FAILED'].includes(activeJob.status)?'Evidence capture in progress':'Analyze Elliott Waves'}</button>
    </div>

    {activeJob&&<div className={`ewr-job ${activeJob.status.toLowerCase()}`}>
      <div><span className="eyebrow">Current Request</span><strong>{activeJob.symbol} · {activeJob.status}</strong><small>{activeJob.uploadedTimeframes?.length||0}/{activeJob.timeframes?.length||21} chart images · {aiState?.evidenceCount||0}/{aiState?.evidenceExpected||21} indicator evidence snapshots</small></div>
      <div className="ewr-progress"><span style={{width:`${activeJob.status==='READY'?100:progress}%`}}></span></div>
    </div>}
    {message&&<div className="ewr-message">{message}</div>}

    <div className="ewr-ai panel">
      <div className="ewr-title"><div><span className="eyebrow">Gemini Multimodal Elliott Audit</span><h3>AI Elliott Trade Decision</h3></div><div className="ewr-ai-actions">{(selected||activeJob?.status==='READY')&&<button type="button" disabled={aiLoading} onClick={()=>runAi((selected?.id||activeJob?.id) as string)}>{aiLoading?'Analyzing…':aiState?.analysis?'Re-open Analysis':'Run AI Analysis'}</button>}<span className={`ewr-ai-status ${(decision?.direction||decision?.status||'idle').toLowerCase()}`}>{decision?`${decision.status.replace('_',' ')} · ${decision.direction}`:aiLoading?'ANALYZING':'AWAITING EVIDENCE'}</span></div></div>
      {!decision?<div className="ewr-empty ai">The trade decision appears here after the PDF and structured indicator evidence are ready. AI cannot create an entry, stop or target unless the Elliott evidence supports one.</div>:<>
        <div className="ewr-trade-strip">
          <div><span>Direction</span><strong>{decision.direction}</strong></div>
          <div><span>Entry</span><strong>{formatPrice(decision.entry.price)}</strong><small>{decision.entry.type}{decision.entry.zoneLow&&decision.entry.zoneHigh?` · ${formatPrice(decision.entry.zoneLow)}–${formatPrice(decision.entry.zoneHigh)}`:''}</small></div>
          <div><span>Stop Loss</span><strong>{formatPrice(decision.stopLoss.price)}</strong><small>{decision.stopLoss.basis||'Elliott invalidation'}</small></div>
          {decision.takeProfits.slice(0,3).map((tp,index)=><div key={`${tp.label}-${index}`}><span>{tp.label||`TP${index+1}`}</span><strong>{formatPrice(tp.price)}</strong><small>{formatRR([decision.riskReward.tp1,decision.riskReward.tp2,decision.riskReward.tp3][index])}</small></div>)}
          <div><span>Confidence</span><strong>{Math.round(decision.confidence)}%</strong><small>{aiState?.analysis?.model||'Gemini'} · evidence {aiState?.evidenceCount||aiState?.analysis?.evidenceCount||0}/{aiState?.evidenceExpected||21}</small></div>
        </div>
        <div className="ewr-thesis-grid">
          <article><span className="eyebrow">Primary Count</span><strong>{decision.elliott.primaryCount||'—'}</strong><p>Current wave: {decision.elliott.currentWave||'—'}</p><p>Higher timeframe: {decision.elliott.higherTimeframeBias||'—'}</p></article>
          <article><span className="eyebrow">Micro Confirmation</span><strong>{decision.elliott.microStructure||'—'}</strong><p>Hard invalidation: {formatPrice(decision.elliott.invalidation)}</p><p>Trigger: {decision.entry.trigger||'—'}</p></article>
          <article><span className="eyebrow">Alternate Count</span><strong>{decision.elliott.alternateCount||'None supplied'}</strong><p>Indicator-plan consistency: {decision.indicatorPlanConsistency?'Aligned':'Not fully aligned'}</p><p>{decision.summary}</p></article>
        </div>
        <div className="ewr-evidence-grid">
          <article><h4>Evidence the AI used</h4>{decision.evidenceSummary.length?<ul>{decision.evidenceSummary.map((item,index)=><li key={index}>{item}</li>)}</ul>:<p>No evidence summary returned.</p>}</article>
          <article><h4>Conflicts / missing evidence</h4>{[...decision.conflicts,...decision.missingEvidence].length?<ul>{[...decision.conflicts,...decision.missingEvidence].map((item,index)=><li key={index}>{item}</li>)}</ul>:<p>No material conflict reported.</p>}</article>
          <article><h4>What invalidates the thesis</h4>{decision.invalidationConditions.length?<ul>{decision.invalidationConditions.map((item,index)=><li key={index}>{item}</li>)}</ul>:<p>Use the displayed Elliott invalidation level and confirmed count rules.</p>}</article>
        </div>
      </>}
    </div>

    <div className="ewr-grid">
      <div className="ewr-library panel">
        <div className="ewr-title"><div><span className="eyebrow">Private Evidence Library</span><h3>Generated PDFs</h3></div><button type="button" onClick={()=>refreshReports().catch(error=>setMessage(String(error.message||error)))}>Refresh</button></div>
        {!reports.length?<div className="ewr-empty">No Elliott PDFs yet. Press Analyze to create the first multi-timeframe evidence report.</div>:<div className="ewr-list">{reports.map(report=><article className={selected?.id===report.id?'selected':''} key={report.id}>
          <div><strong>{report.symbol}</strong><span>{report.pageCount} pages · {formatTime(report.completedAt)}</span><small>{report.fileName}</small></div>
          <div className="ewr-actions"><button type="button" onClick={()=>selectReport(report)}>View + AI</button><a href={absolutePdfUrl(report.pdfUrl)} target="_blank" rel="noreferrer">Open PDF</a></div>
        </article>)}</div>}
      </div>
      <div className="ewr-viewer panel">
        <div className="ewr-title"><div><span className="eyebrow">Screenshot Evidence PDF</span><h3>{selected?`${selected.symbol} Elliott Analysis`:'Select a report'}</h3></div>{selected&&<a href={absolutePdfUrl(selected.pdfUrl)} target="_blank" rel="noreferrer">Full screen</a>}</div>
        {selected?<iframe title={`${selected.symbol} Elliott Wave PDF`} src={absolutePdfUrl(selected.pdfUrl)}/>:<div className="ewr-empty viewer">Choose View + AI on a generated report to inspect every timeframe and its stored AI decision.</div>}
      </div>
    </div>
    <small className="ewr-foot">Last MT5 bridge heartbeat: {formatTime(bridge.lastSeen)}{bridge.terminalId?` · ${bridge.terminalId}`:''}. Screenshots, PDFs, indicator evidence and AI decisions stay in private Google Cloud Firestore storage. The AI is advisory and never places an order.</small>
  </section>;
}
