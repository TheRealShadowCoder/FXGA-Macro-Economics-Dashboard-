import { useEffect,useState } from 'react';
import { fetchDashboard,fetchSessionSignals } from '../lib/api';
import type { DashboardPayload,SessionSignalsPayload } from '../lib/types';
import { CurrentEvidencePack } from './CurrentEvidencePack';
import { CanonicalMT5Evidence } from './CanonicalMT5Evidence';
import './EvidencePackDock.css';

const sleep=(ms:number)=>new Promise(resolve=>window.setTimeout(resolve,ms));

export function EvidencePackDock(){
  const[open,setOpen]=useState(false),[dashboard,setDashboard]=useState<DashboardPayload|null>(null),[signals,setSignals]=useState<SessionSignalsPayload|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=async()=>{
    if(loading)return false;
    setLoading(true);setError('');
    try{const[d,s]=await Promise.all([fetchDashboard(),fetchSessionSignals()]);setDashboard(d);setSignals(s);return true;}
    catch(caught){setError(caught instanceof Error?caught.message:'Unable to load current evidence');return false;}
    finally{setLoading(false);}
  };
  useEffect(()=>{if(open&&!dashboard)void load();},[open,dashboard]);

  const waitForCanonicalMT5=async()=>{
    // Give React one render cycle to start the canonical MT5 refresh after the
    // dashboard/session snapshot changes, then wait until the refresh completes.
    await sleep(180);
    for(let attempt=0;attempt<180;attempt++){
      const label=document.querySelector('.canonical-mt5-evidence .mt5-evidence-cover b')?.textContent||'';
      if(label&&!/refreshing|waiting/i.test(label))return true;
      await sleep(250);
    }
    return false;
  };

  const rebuildCurrentPack=async()=>{
    const buildButton=document.querySelector<HTMLButtonElement>('.current-evidence-pack .evidence-controls button:not(.primary)');
    if(!buildButton)return false;
    buildButton.click();
    for(let attempt=0;attempt<360;attempt++){
      const current=document.querySelector<HTMLButtonElement>('.current-evidence-pack .evidence-controls button:not(.primary)');
      if(current&&!current.disabled&&!/refreshing/i.test(current.textContent||''))return true;
      await sleep(250);
    }
    return false;
  };

  const exportFull=async()=>{
    if(loading)return;
    const started=new Date();
    setNotice('Refreshing dashboard, session, signal and canonical MT5 evidence before this PDF…');
    const refreshed=await load();
    if(!refreshed){setNotice('The current evidence refresh did not complete, so the PDF was not opened.');return;}
    const mt5Ready=await waitForCanonicalMT5();
    if(!mt5Ready){setNotice('Canonical MT5 timeframe data did not finish refreshing in time, so the PDF was not opened with stale bars.');return;}
    setNotice('MT5 M1→D1 evidence is current. Refreshing the report price tape, technical state and live signal-source scan…');
    const reportReady=await rebuildCurrentPack();
    if(!reportReady){setNotice('The report evidence refresh did not finish in time, so the PDF was not opened.');return;}
    const printButton=document.querySelector<HTMLButtonElement>('.current-evidence-pack .evidence-controls button.primary');
    if(!printButton){setNotice('The current evidence pack is still loading.');return;}
    setNotice(`Evidence refreshed from ${started.toLocaleTimeString()} onward. Opening the complete PDF print dialog…`);
    printButton.click();
  };

  return <div className={`evidence-pack-dock ${open?'open':''}`}>
    <button className="evidence-pack-toggle" type="button" onClick={()=>setOpen(v=>!v)} title="Current market PDF evidence pack"><span>PDF</span><div><strong>MARKET EVIDENCE</strong><small>{loading?'REFRESHING':dashboard?'CURRENT SNAPSHOT':'PDF + TIMEFRAMES'}</small></div><b>{open?'×':'↗'}</b></button>
    {open?<div className="evidence-pack-panel"><div className="evidence-pack-toolbar"><div><span>FXGA · CURRENT MARKET EVIDENCE</span><h3>Chart screenshots, exact prices and current signal-source search</h3><p>Every export refreshes current data first. Canonical MT5 pages include M1, M5, M15, M30, H1, H4 and D1 for the strongest current symbols.</p></div><div><button type="button" onClick={()=>void load()} disabled={loading}>{loading?'Refreshing…':'Refresh all'}</button><button type="button" className="export" onClick={()=>void exportFull()} disabled={loading||!dashboard}>Export full PDF</button></div></div>
      {notice?<div className="evidence-pack-notice">{notice}</div>:null}{error?<div className="evidence-pack-error">{error}</div>:null}
      {dashboard?<div className="evidence-pack-output"><CurrentEvidencePack dashboard={dashboard} signals={signals}/><CanonicalMT5Evidence dashboard={dashboard} signals={signals}/></div>:<div className="evidence-pack-loading">{loading?'Searching the current price, technical and signal evidence network…':'Open the evidence pack to load the current snapshot.'}</div>}
    </div>:null}
  </div>;
}