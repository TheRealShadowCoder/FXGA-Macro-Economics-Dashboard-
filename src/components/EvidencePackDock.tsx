import { useEffect,useState } from 'react';
import { fetchDashboard,fetchSessionSignals } from '../lib/api';
import type { DashboardPayload,SessionSignalsPayload } from '../lib/types';
import { CurrentEvidencePack } from './CurrentEvidencePack';
import { CanonicalMT5Evidence } from './CanonicalMT5Evidence';
import './EvidencePackDock.css';

export function EvidencePackDock(){
  const[open,setOpen]=useState(false),[dashboard,setDashboard]=useState<DashboardPayload|null>(null),[signals,setSignals]=useState<SessionSignalsPayload|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=async()=>{if(loading)return;setLoading(true);setError('');try{const[d,s]=await Promise.all([fetchDashboard(),fetchSessionSignals()]);setDashboard(d);setSignals(s);}catch(caught){setError(caught instanceof Error?caught.message:'Unable to load current evidence');}finally{setLoading(false);}};
  useEffect(()=>{if(open&&!dashboard)void load();},[open,dashboard]);
  const exportFull=()=>{
    const mt5Text=document.querySelector('.canonical-mt5-evidence .mt5-evidence-cover b')?.textContent||'';
    if(/refreshing|waiting/i.test(mt5Text)){setNotice('Canonical MT5 timeframe scan is still refreshing. Wait a few seconds so M1 through D1 are frozen into the same PDF.');return;}
    const button=document.querySelector<HTMLButtonElement>('.current-evidence-pack .evidence-controls button.primary');
    if(!button){setNotice('The current evidence pack is still loading.');return;}
    setNotice('Building a fresh current snapshot, then opening the browser PDF dialog…');button.click();
  };
  return <div className={`evidence-pack-dock ${open?'open':''}`}>
    <button className="evidence-pack-toggle" type="button" onClick={()=>setOpen(v=>!v)} title="Current market PDF evidence pack"><span>PDF</span><div><strong>MARKET EVIDENCE</strong><small>{loading?'REFRESHING':dashboard?'CURRENT SNAPSHOT':'PDF + TIMEFRAMES'}</small></div><b>{open?'×':'↗'}</b></button>
    {open?<div className="evidence-pack-panel"><div className="evidence-pack-toolbar"><div><span>FXGA · CURRENT MARKET EVIDENCE</span><h3>Chart screenshots, exact prices and current signal-source search</h3><p>Every export refreshes current data first. Canonical MT5 pages include M1, M5, M15, M30, H1, H4 and D1 for the strongest current symbols.</p></div><div><button type="button" onClick={()=>void load()} disabled={loading}>{loading?'Refreshing…':'Refresh all'}</button><button type="button" className="export" onClick={exportFull} disabled={loading||!dashboard}>Export full PDF</button></div></div>
      {notice?<div className="evidence-pack-notice">{notice}</div>:null}{error?<div className="evidence-pack-error">{error}</div>:null}
      {dashboard?<div className="evidence-pack-output"><CurrentEvidencePack dashboard={dashboard} signals={signals}/><CanonicalMT5Evidence dashboard={dashboard} signals={signals}/></div>:<div className="evidence-pack-loading">{loading?'Searching the current price, technical and signal evidence network…':'Open the evidence pack to load the current snapshot.'}</div>}
    </div>:null}
  </div>;
}
