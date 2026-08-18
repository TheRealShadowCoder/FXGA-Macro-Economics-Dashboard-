import './PolicyCalibrationPanel.css';

export type PolicyCalibrationMetric={frozen:number;scored:number;pending:number;topActionAccuracy:number|null;averageBrier:number|null;averageLogLoss:number|null;brierSkillVsUniform:number|null;sampleConfidence:number;status:string};
export type PolicyCalibrationResearch={generatedAt:string;global:PolicyCalibrationMetric;byCurrency:Record<string,PolicyCalibrationMetric>;methodology:string};
const pct=(v:number|null)=>v==null?'—':`${Math.round(v*100)}%`;
const num=(v:number|null,d=3)=>v==null?'—':Number(v).toFixed(d);
const cls=(status:string)=>status==='calibrating-well'?'positive':status==='needs-recalibration'?'negative':'neutral';

export function PolicyCalibrationPanel({data}:{data?:PolicyCalibrationResearch|null}){
  if(!data)return null;
  const rows=Object.entries(data.byCurrency||{}).sort((a,b)=>b[1].scored-a[1].scored||b[1].frozen-a[1].frozen);
  return <>
    <section className="section-head policy-calibration-head"><div><span className="eyebrow">Policy Forecast Audit</span><h2>Are the central-bank probabilities actually calibrated?</h2><p>Probabilities are frozen before each scheduled policy decision and scored only after the actual rate outcome is known. No meeting can be rewritten after the fact.</p></div></section>
    <section className="panel policy-calibration-panel">
      <div className="policy-calibration-summary">
        <div><small>Frozen forecasts</small><strong>{data.global.frozen}</strong></div>
        <div><small>Scored decisions</small><strong>{data.global.scored}</strong></div>
        <div><small>Top-action accuracy</small><strong>{pct(data.global.topActionAccuracy)}</strong></div>
        <div><small>Brier skill vs uniform</small><strong className={data.global.brierSkillVsUniform!=null&&data.global.brierSkillVsUniform>0?'positive':data.global.brierSkillVsUniform!=null&&data.global.brierSkillVsUniform<0?'negative':'neutral'}>{pct(data.global.brierSkillVsUniform)}</strong></div>
      </div>
      <div className="policy-calibration-table">{rows.map(([currency,row])=><div className="policy-calibration-row" key={currency}><div><strong>{currency}</strong><small>{row.scored} scored · {row.pending} pending · {row.frozen} frozen</small></div><span className={cls(row.status)}>{row.status.replaceAll('-',' ')}</span><span>Accuracy {pct(row.topActionAccuracy)}</span><span>Brier {num(row.averageBrier)}</span><span>Log loss {num(row.averageLogLoss)}</span><span>Sample {pct(row.sampleConfidence)}</span></div>)}</div>
      {!data.global.scored&&<p className="policy-calibration-building">Calibration is building from zero rather than backfilling synthetic wins. Scores will appear only after genuinely frozen forecasts reach realized policy decisions.</p>}
      <details><summary>Scoring methodology</summary><p>{data.methodology}</p></details>
    </section>
  </>;
}
