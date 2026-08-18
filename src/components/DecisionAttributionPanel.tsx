import './DecisionAttributionPanel.css';

type AttributionFeature={id:string;label:string;samples:number;association:number;shrunkAssociation:number;status:string;topMinusBottomBps:number|null};
type AttributionSummary={samples:number;features:AttributionFeature[];mostHelpful:AttributionFeature[];mostHarmful:AttributionFeature[];unproven:number};
export type DecisionQualityAttribution={generatedAt:string;sampledRealizedStates:number;global:AttributionSummary;bySymbol:Record<string,AttributionSummary>;methodology:string};

const pct=(v:number)=>`${v>=0?'+':''}${Math.round(v*100)}%`;
const bps=(v:number|null)=>v==null?'—':`${v>0?'+':''}${v.toFixed(1)} bps`;
const cls=(status:string)=>status==='helpful'?'positive':status==='harmful'?'negative':'neutral';

export function DecisionAttributionPanel({data}:{data?:DecisionQualityAttribution|null}){
  if(!data)return null;
  const ranked=[...(data.global?.features||[])].sort((a,b)=>Math.abs(b.shrunkAssociation)-Math.abs(a.shrunkAssociation)).slice(0,10);
  return <>
    <section className="section-head attribution-head"><div><span className="eyebrow">Realized Decision Attribution</span><h2>Which evidence conditions were associated with better outcomes?</h2><p>This audit uses prior frozen decisions and realized market outcomes. It measures historical association only, applies small-sample shrinkage, and never creates a new directional vote.</p></div></section>
    <section className="panel attribution-panel">
      <div className="attribution-summary"><div><small>Realized states</small><strong>{data.sampledRealizedStates}</strong></div><div><small>Helpful signals</small><strong>{data.global?.mostHelpful?.length||0}</strong></div><div><small>Harmful signals</small><strong>{data.global?.mostHarmful?.length||0}</strong></div><div><small>Unproven</small><strong>{data.global?.unproven||0}</strong></div></div>
      <div className="attribution-table">{ranked.map(row=><div className="attribution-row" key={row.id}><div><strong>{row.label}</strong><small>{row.samples} realized samples</small></div><span className={cls(row.status)}>{row.status}</span><span>Assoc {pct(row.shrunkAssociation)}</span><span>Top vs bottom {bps(row.topMinusBottomBps)}</span></div>)}</div>
      {!data.sampledRealizedStates&&<p className="attribution-building">Decision attribution is building. It will remain non-directional until frozen decisions accumulate verified realized outcomes.</p>}
      <details><summary>Attribution methodology</summary><p>{data.methodology}</p></details>
    </section>
  </>;
}
