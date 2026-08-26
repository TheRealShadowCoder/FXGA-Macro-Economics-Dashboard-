import { useCallback, useEffect, useMemo, useState } from 'react';
import './ElliottWaveReports.css';

const ALL_MT5_TIMEFRAMES=['M1','M2','M3','M4','M5','M6','M10','M12','M15','M20','M30','H1','H2','H3','H4','H6','H8','H12','D1','W1','MN1'];
const API_BASE=String((import.meta as ImportMeta & { env?: Record<string,string|undefined> }).env?.VITE_GOOGLE_CLOUD_API_BASE||'').trim().replace(/\/+$/,'');

type BridgeState={online:boolean;lastSeen:string|null;terminalId:string|null};
type ElliottReport={id:string;symbol:string;timeframes:string[];pageCount:number;createdAt:string|null;completedAt:string|null;fileName:string;pdfUrl:string};
type ElliottJob={id:string;status:string;symbol:string;timeframes:string[];uploadedTimeframes:string[];createdAt:string|null;updatedAt:string|null;error:string|null;reportId:string|null};

function formatTime(value:string|null){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString();}
function apiUrl(path:string){return API_BASE?`${API_BASE}${path}`:path;}
function absolutePdfUrl(path:string){return API_BASE?`${API_BASE}${path}`:new URL(path,window.location.origin).toString();}

export function ElliottWaveReports(){
  const [symbol,setSymbol]=useState('XAUUSD');
  const [bridge,setBridge]=useState<BridgeState>({online:false,lastSeen:null,terminalId:null});
  const [reports,setReports]=useState<ElliottReport[]>([]);
  const [activeJob,setActiveJob]=useState<ElliottJob|null>(null);
  const [selected,setSelected]=useState<ElliottReport|null>(null);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');

  const progress=useMemo(()=>activeJob?.timeframes?.length?Math.round((activeJob.uploadedTimeframes?.length||0)/activeJob.timeframes.length*100):0,[activeJob]);

  const refreshReports=useCallback(async()=>{
    const response=await fetch(apiUrl('/api/elliott-reports'),{headers:{Accept:'application/json','Cache-Control':'no-cache'}});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||`Reports API ${response.status}`);
    setReports(Array.isArray(payload.reports)?payload.reports:[]);
    setBridge(payload.bridge||{online:false,lastSeen:null,terminalId:null});
  },[]);

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
        if(job.status==='READY'){
          setMessage('Multi-timeframe Elliott PDF is ready.');
          await refreshReports();
        }else if(job.status==='FAILED')setMessage(job.error||'MT5 report capture failed.');
      }catch(error){if(!cancelled)setMessage(String((error as Error).message||error));}
    };
    poll();const timer=window.setInterval(poll,2000);return()=>{cancelled=true;window.clearInterval(timer);};
  },[activeJob?.id,activeJob?.status,refreshReports]);

  const analyze=async()=>{
    const clean=String(symbol||'XAUUSD').trim().toUpperCase().replace(/[^A-Z0-9._-]/g,'').slice(0,32)||'XAUUSD';
    setSymbol(clean);setLoading(true);setMessage('Sending an on-demand capture job to MT5…');
    try{
      const response=await fetch(apiUrl('/api/elliott-reports/request'),{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({symbol:clean,timeframes:ALL_MT5_TIMEFRAMES})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||`Analyze request ${response.status}`);
      setActiveJob(payload.job);setMessage(bridge.online?'MT5 accepted queue polling. Screenshots will be captured only for this Analyze request.':'Analyze job queued. MT5 is currently offline; capture will start when the bridge reconnects.');
    }catch(error){setMessage(String((error as Error).message||error));}finally{setLoading(false);}
  };

  return <section className="ewr-shell">
    <div className="ewr-head">
      <div><span className="eyebrow">MT5 Elliott Wave Report Bridge</span><h2>Elliott Wave PDF Reports</h2><p>One on-demand PDF with screenshots of all 21 standard MT5 timeframes. MT5 captures nothing until you press Analyze.</p></div>
      <span className={`ewr-bridge ${bridge.online?'online':'offline'}`}><i></i>{bridge.online?'MT5 bridge online':'MT5 bridge offline'}</span>
    </div>

    <div className="ewr-control panel">
      <label><span>Symbol</span><input value={symbol} onChange={event=>setSymbol(event.target.value.toUpperCase())} onKeyDown={event=>{if(event.key==='Enter'&&!loading)analyze();}} placeholder="XAUUSD" maxLength={32}/></label>
      <div className="ewr-tf"><span>Capture scope</span><strong>All 21 MT5 timeframes</strong><small>{ALL_MT5_TIMEFRAMES.join(' · ')}</small></div>
      <button className="ewr-analyze" type="button" disabled={loading||Boolean(activeJob&&!['READY','FAILED'].includes(activeJob.status))} onClick={analyze}>{loading?'Queuing…':activeJob&&!['READY','FAILED'].includes(activeJob.status)?'Analysis in progress':'Analyze Elliott Waves'}</button>
    </div>

    {activeJob&&<div className={`ewr-job ${activeJob.status.toLowerCase()}`}>
      <div><span className="eyebrow">Current Request</span><strong>{activeJob.symbol} · {activeJob.status}</strong><small>{activeJob.uploadedTimeframes?.length||0}/{activeJob.timeframes?.length||21} timeframe images uploaded</small></div>
      <div className="ewr-progress"><span style={{width:`${activeJob.status==='READY'?100:progress}%`}}></span></div>
    </div>}
    {message&&<div className="ewr-message">{message}</div>}

    <div className="ewr-grid">
      <div className="ewr-library panel">
        <div className="ewr-title"><div><span className="eyebrow">Private Report Library</span><h3>Generated PDFs</h3></div><button type="button" onClick={()=>refreshReports().catch(error=>setMessage(String(error.message||error)))}>Refresh</button></div>
        {!reports.length?<div className="ewr-empty">No Elliott PDFs yet. Press Analyze to create the first multi-timeframe report.</div>:<div className="ewr-list">{reports.map(report=><article className={selected?.id===report.id?'selected':''} key={report.id}>
          <div><strong>{report.symbol}</strong><span>{report.pageCount} pages · {formatTime(report.completedAt)}</span><small>{report.fileName}</small></div>
          <div className="ewr-actions"><button type="button" onClick={()=>setSelected(report)}>View</button><a href={absolutePdfUrl(report.pdfUrl)} target="_blank" rel="noreferrer">Open PDF</a></div>
        </article>)}</div>}
      </div>
      <div className="ewr-viewer panel">
        <div className="ewr-title"><div><span className="eyebrow">PDF Viewer</span><h3>{selected?`${selected.symbol} Elliott Analysis`:'Select a report'}</h3></div>{selected&&<a href={absolutePdfUrl(selected.pdfUrl)} target="_blank" rel="noreferrer">Full screen</a>}</div>
        {selected?<iframe title={`${selected.symbol} Elliott Wave PDF`} src={absolutePdfUrl(selected.pdfUrl)}/>:<div className="ewr-empty viewer">Choose View on a generated PDF to inspect every timeframe chart without leaving the dashboard.</div>}
      </div>
    </div>
    <small className="ewr-foot">Last MT5 bridge heartbeat: {formatTime(bridge.lastSeen)}{bridge.terminalId?` · ${bridge.terminalId}`:''}. PDFs remain in private Google Cloud Firestore storage and are streamed through this website API.</small>
  </section>;
}
