import './PolicyCalibrationPanel.css';

export type PolicyCalibrationMetric={frozen:number;uniqueDecisions?:number;scored:number;pending:number;topActionAccuracy:number|null;averageBrier:number|null;averageLogLoss:number|null;brierSkillVsUniform:number|null;sampleConfidence:number;averageLeadHours?:number|null;status:string};
type LeadBucket={id:string;label:string;targetHours:number;minExclusiveHours:number;maxHours:number};
type LeadComparison={fromBucket:string;toBucket:string;pairs:number;averageBrierImprovement:number|null;averageLogLossImprovement:number|null;status:string};
export type PolicyCalibrationResearch={generatedAt:string;auditVersion?:number;leadBuckets?:LeadBucket[];global:PolicyCalibrationMetric;byCurrency:Record<string,PolicyCalibrationMetric>;byLeadBucket?:Record<string,PolicyCalibrationMetric>;leadComparisons?:LeadComparison[];methodology:string};
const pct=(v:number|null|undefined)=>v==null?'—':`${Math.round(v*100)}%`;
const num=(v:number|null|undefined,d=3)=>v==null?'—':Number(v).toFixed(d);
const cls=(status:string)=>status==='calibrating-well'||status==='improving'?'positive':status==='needs-recalibration'||status==='worsening'?'negative':'neutral';
const label=(value:string)=>value.replaceAll('-',' ').replace(/\b\w/g,m=>m.toUpperCase());

export function PolicyCalibrationPanel({data}:{data?:PolicyCalibrationResearch|null}){
  if(!data)return null;
  const rows=Object.entries(data.byCurrency||{}).sort((a,b)=>b[1].scored-a[1].scored||b[1].frozen-a[1].frozen);
  const buckets=(data.leadBuckets||[]).map(bucket=>({bucket,metric:data.byLeadBucket?.[bucket.id]}));
  const comparisons=(data.leadComparisons||[]).filter(x=>x.pairs>0);
  return <>
    <section className="section-head policy-calibration-head"><div><span className="eyebrow">Policy Forecast Audit</span><h2>Does policy probability accuracy improve as the meeting approaches?</h2><p>Each meeting can now accumulate immutable snapshots across separate lead windows. Missing earlier windows are never backfilled, and every snapshot waits for the real rate outcome before receiving a score.</p></div></section>
    <section className="panel policy-calibration-panel">
      <div className="policy-calibration-summary">
        <div><small>Frozen snapshots</small><strong>{data.global.frozen}</strong></div>
        <div><small>Unique decisions</small><strong>{data.global.uniqueDecisions??data.global.frozen}</strong></div>
        <div><small>Scored snapshots</small><strong>{data.global.scored}</strong></div>
        <div><small>Brier skill vs uniform</small><strong className={data.global.brierSkillVsUniform!=null&&data.global.brierSkillVsUniform>0?'positive':data.global.brierSkillVsUniform!=null&&data.global.brierSkillVsUniform<0?'negative':'neutral'}>{pct(data.global.brierSkillVsUniform)}</strong></div>
      </div>

      {buckets.length>0&&<div className="policy-lead-block"><div className="policy-lead-title"><div><span className="eyebrow">Lead-Time Calibration Curve</span><h3>Immutable snapshot windows</h3></div><small>Exact lead hours are retained on every audit row</small></div><div className="policy-lead-grid">{buckets.map(({bucket,metric})=><div className="policy-lead-card" key={bucket.id}><div><strong>{bucket.label}</strong><span className={cls(metric?.status||'building')}>{label(metric?.status||'building')}</span></div><small>{metric?.scored||0} scored · {metric?.pending||0} pending · {metric?.frozen||0} frozen</small><div className="policy-lead-metrics"><span>Brier <b>{num(metric?.averageBrier)}</b></span><span>Log loss <b>{num(metric?.averageLogLoss)}</b></span><span>Accuracy <b>{pct(metric?.topActionAccuracy)}</b></span><span>Sample <b>{pct(metric?.sampleConfidence)}</b></span></div></div>)}</div></div>}

      {comparisons.length>0&&<div className="policy-lead-comparisons"><span className="eyebrow">Matched-Decision Improvement</span>{comparisons.map(row=><div key={`${row.fromBucket}-${row.toBucket}`}><strong>{label(row.fromBucket)} → {label(row.toBucket)}</strong><span className={cls(row.status)}>{row.status}</span><small>{row.pairs} matched decisions · Brier improvement {num(row.averageBrierImprovement)} · log-loss improvement {num(row.averageLogLossImprovement)}</small></div>)}</div>}

      <div className="policy-calibration-table">{rows.map(([currency,row])=><div className="policy-calibration-row" key={currency}><div><strong>{currency}</strong><small>{row.scored} scored snapshots · {row.pending} pending · {row.uniqueDecisions??row.frozen} decisions</small></div><span className={cls(row.status)}>{row.status.replaceAll('-',' ')}</span><span>Accuracy {pct(row.topActionAccuracy)}</span><span>Brier {num(row.averageBrier)}</span><span>Log loss {num(row.averageLogLoss)}</span><span>Sample {pct(row.sampleConfidence)}</span></div>)}</div>
      {!data.global.scored&&<p className="policy-calibration-building">Calibration is building from genuine frozen forecasts only. The current pending snapshots will receive scores only after their actual policy decisions are published.</p>}
      <details><summary>Scoring methodology</summary><p>{data.methodology}</p></details>
    </section>
  </>;
}
