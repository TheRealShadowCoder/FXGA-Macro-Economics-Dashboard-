import { useEffect, useMemo, useState } from 'react';
import { fetchTechnicalSnapshot } from '../lib/api';
import type { TechnicalSnapshotPayload } from '../lib/types';
import './CrossAssetHistoryProgress.css';

type FrameProgress={bars:number;requiredBars:number;progress:number};
type HistoryBuild={overallPercent:number;measuredBars:number;requiredBars:number;trackedAssets?:number;updatedAt?:string;status?:string;phase?:string;message?:string;perAsset:Record<string,Record<string,FrameProgress>>};
const TRACKED=['EURUSD','GBPUSD','USDJPY','USDZAR','EURZAR','GBPZAR','EURGBP','XAUUSD'];
const REQUIRED:Record<string,number>={M5:48,M15:40,H1:30,H4:24,D1:20};
const FRAMES=['M5','M15','H1','H4','D1'];

function deriveFallback(technical:TechnicalSnapshotPayload):HistoryBuild{
  const perAsset:HistoryBuild['perAsset']={};let measured=0,requiredTotal=0;
  for(const id of TRACKED){
    const frames:Record<string,FrameProgress>={};
    for(const frame of FRAMES){
      const required=REQUIRED[frame],bars=technical.assets?.[id]?.timeframes?.[frame]?.bars??0;
      frames[frame]={bars,requiredBars:required,progress:Math.min(100,Math.round((bars/required)*100))};
      measured+=Math.min(bars,required);requiredTotal+=required;
    }
    perAsset[id]=frames;
  }
  const overallPercent=requiredTotal?Math.round(measured/requiredTotal*100):0;
  return {overallPercent,measuredBars:measured,requiredBars:requiredTotal,trackedAssets:TRACKED.length,updatedAt:technical.generatedAt??undefined,status:overallPercent>=95?'mature':'building-forward',phase:'live-sampling',message:overallPercent>=95?'Cross asset history is mature.':'Google Cloud is extending verified cross asset history.',perAsset};
}

const phaseLabel=(history:HistoryBuild)=>{
  const phase=String(history.phase||'').toUpperCase();
  if(history.status==='blocked')return 'Provider history blocked';
  if(history.status==='mature')return 'History mature';
  if(phase==='STARTING')return 'Starting verified history';
  if(phase==='M5')return 'M5 imported · building M15/H1';
  if(phase==='M15_H1')return 'M15/H1 imported · building H4';
  if(phase==='H4')return 'H4 imported · building D1';
  if(phase==='LIVE-SAMPLING')return 'Building forward from live samples';
  return 'Verified history building';
};

export function CrossAssetHistoryProgress(){
  const [technical,setTechnical]=useState<TechnicalSnapshotPayload|null>(null);
  const [error,setError]=useState('');

  useEffect(()=>{
    let stopped=false,timer:number|undefined;
    const load=async()=>{
      try{const next=await fetchTechnicalSnapshot();if(!stopped){setTechnical(next);setError('');}}
      catch(caught){if(!stopped)setError(caught instanceof Error?caught.message:'History state unavailable');}
    };
    void load();
    timer=window.setInterval(()=>void load(),20_000);
    return()=>{stopped=true;if(timer!==undefined)window.clearInterval(timer);};
  },[]);

  const history=useMemo(()=>{
    if(!technical)return null;
    const server=(technical as TechnicalSnapshotPayload&{historyBuild?:HistoryBuild}).historyBuild;
    return server?.perAsset?server:deriveFallback(technical);
  },[technical]);

  const frameProgress=useMemo(()=>Object.fromEntries(FRAMES.map(frame=>{
    if(!history)return[frame,0];
    const rows=TRACKED.map(id=>history.perAsset?.[id]?.[frame]?.progress??0);
    return[frame,Math.round(rows.reduce((sum,value)=>sum+value,0)/Math.max(1,rows.length))];
  })),[history]);

  if(!history)return <section className="panel cross-history"><div><span className="eyebrow">Cross Asset History</span><h2>Initializing verified history</h2><p>{error||'Reading the Google Cloud technical-history ledger…'}</p></div></section>;

  return <section className="panel cross-history" data-explain-key="historical backtesting">
    <div className="cross-history-head">
      <div><span className="eyebrow">Cross Asset History · {phaseLabel(history)}</span><h2>Verified bar history build</h2><p>{history.message||'Historical OHLC is bootstrapped from verified provider bars and then maintained by the Google Cloud market sampler. Missing candles are never invented.'}</p></div>
      <div className="cross-history-score"><strong>{history.overallPercent}%</strong><span>{history.measuredBars}/{history.requiredBars} readiness bars</span></div>
    </div>
    <div className="cross-history-track"><i style={{width:`${Math.max(0,Math.min(100,history.overallPercent))}%`}} /></div>
    <div className="cross-history-frames">{FRAMES.map(frame=><div key={frame}><span>{frame}</span><strong>{frameProgress[frame]}%</strong><i><b style={{width:`${frameProgress[frame]}%`}} /></i></div>)}</div>
    <small>{history.updatedAt?`History ledger updated ${new Date(history.updatedAt).toLocaleString()}`:'Google Cloud history ledger active'} · {history.trackedAssets??TRACKED.length} tracked cross-asset instruments · refreshes every 20 seconds</small>
  </section>;
}
