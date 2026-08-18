import './AdaptiveResearchPanel.css';

type SourceReliability={source:string;series:number;score:number;status:string;numericCoverage:number;freshness:number;historyDepth:number;anomalyRate:number};
type Forecast={seriesId:string;title:string;economy:string;family:string;latest:number;forecast:number;delta:number;modelWeights?:Record<string,number>;walkForwardRmse?:Record<string,number|null>;validationPoints?:number;modelAgreement?:number;calibrationConfidence?:number;modelDispersion?:number;uncertainty?:number;driftScore?:number;driftStatus?:string;forecastBias?:number};

const pct=(v:number)=>`${Math.round(v*100)}%`;
const scoreClass=(v:number)=>v>=80?'positive':v>=60?'neutral':'negative';
const driftClass=(status?:string)=>status==='drifting'?'negative':status==='watch'?'neutral':'positive';
const format=(v:number|null|undefined)=>Number.isFinite(Number(v))?Number(v).toLocaleString(undefined,{maximumFractionDigits:3}):'—';

export function AdaptiveResearchPanel({sources=[],forecasts=[]}:{sources?:SourceReliability[];forecasts?:Forecast[]}){
  const calibrated=forecasts.filter(f=>f.modelWeights&&Number(f.validationPoints||0)>0).sort((a,b)=>Number(b.calibrationConfidence||0)-Number(a.calibrationConfidence||0)).slice(0,12);
  if(!sources.length&&!calibrated.length)return null;
  return <>
    <section className="section-head adaptive-research-head"><div><span className="eyebrow">Adaptive Research Quality</span><h2>Models and sources must earn influence</h2><p>Forecast weights are learned from walk-forward errors. Recent forecast deterioration reduces confidence automatically, while data sources are ranked by completeness, freshness, historical depth and anomaly behavior.</p></div></section>
    <section className="adaptive-research-grid">
      <article className="panel adaptive-source-panel">
        <div className="panel-title"><div><span className="eyebrow">Source Reliability</span><h2>Evidence quality by source</h2></div><span>{sources.length} assessed</span></div>
        <div className="adaptive-source-list">{sources.slice(0,12).map(source=><div className="adaptive-source-row" key={source.source}><div><strong>{source.source}</strong><small>{source.series} series · {source.status}</small></div><div className="adaptive-source-metrics"><span>Fresh {pct(source.freshness)}</span><span>History {pct(source.historyDepth)}</span><span>Anomaly {pct(source.anomalyRate)}</span></div><b className={scoreClass(source.score)}>{source.score}</b></div>)}</div>
      </article>
      <article className="panel adaptive-forecast-panel">
        <div className="panel-title"><div><span className="eyebrow">Walk Forward Calibration</span><h2>Forecast ensemble accountability</h2></div><span>{calibrated.length} shown</span></div>
        <div className="adaptive-forecast-list">{calibrated.map(row=>{
          const weights=Object.entries(row.modelWeights||{}).sort((a,b)=>b[1]-a[1]);
          return <div className="adaptive-forecast-row" key={row.seriesId}>
            <div className="adaptive-forecast-main"><div><strong>{row.seriesId}</strong><small>{row.title} · {row.economy}</small></div><b className={Number(row.delta)>=0?'positive':'negative'}>{Number(row.delta)>0?'+':''}{format(row.delta)}</b></div>
            <div className="adaptive-weights">{weights.map(([model,weight])=><span key={model}>{model} <b>{pct(weight)}</b></span>)}</div>
            <div className="adaptive-validation"><span>{row.validationPoints} walk-forward tests</span><span>Agreement {pct(Number(row.modelAgreement||0))}</span><span>Calibration {pct(Number(row.calibrationConfidence||0))}</span><span>Uncertainty {format(row.uncertainty)}</span>{row.driftStatus&&<span className={driftClass(row.driftStatus)}>Drift {row.driftStatus} · {Math.round(Number(row.driftScore||0))}</span>}{Number.isFinite(Number(row.forecastBias))&&<span>Bias {format(row.forecastBias)}</span>}</div>
          </div>;
        })}</div>
      </article>
    </section>
  </>;
}
