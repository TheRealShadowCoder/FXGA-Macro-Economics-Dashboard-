import './TransitionResearchPanel.css';

type TurningFamily={economy:string;family:string;series:number;risk:number;status:string;reversals:number;averageAcceleration:number;breadth:number;direction:string;topSeries:Array<{seriesId:string;title:string;turningPointScore:number;slopeReversal:boolean}>};
type TurningEconomy={economy:string;risk:number;highFamilies:number;watchFamilies:number;direction:string;families:TurningFamily[]};
type TurningPoints={economies:TurningEconomy[];rows:TurningFamily[];highRisk:number;watch:number};
type CatalystCurrency={currency:string;events:number;highImpact:number;clusters:number;nearestGapMinutes:number|null;densityScore:number;status:string;next:Array<{event:string;date:string;importance:number;category:string}>};
type CatalystSequence={windowHours:number;currencies:CatalystCurrency[];totalUpcoming:number;denseCurrencies:number};
type Persistence={currency:string;family:string;count:number;streak:number;recentMean:number;priorMean:number;acceleration:number;consistency:number;status:string};

const riskClass=(v:number)=>v>=70?'negative':v>=45?'neutral':'positive';
const signed=(v:number,digits=0)=>`${v>0?'+':''}${Number(v).toFixed(digits)}`;
const pretty=(v:string)=>v.replaceAll('-',' ').replace(/\b\w/g,m=>m.toUpperCase());

export function TransitionResearchPanel({turningPoints,catalystSequence,persistence=[]}:{turningPoints?:TurningPoints|null;catalystSequence?:CatalystSequence|null;persistence?:Persistence[]}){
  if(!turningPoints&&!catalystSequence&&!persistence.length)return null;
  const economies=[...(turningPoints?.economies||[])].sort((a,b)=>b.risk-a.risk).slice(0,5);
  const catalysts=[...(catalystSequence?.currencies||[])].sort((a,b)=>b.densityScore-a.densityScore).slice(0,6);
  const persistent=[...persistence].sort((a,b)=>Math.abs(b.streak)-Math.abs(a.streak)||Math.abs(b.acceleration)-Math.abs(a.acceleration)).slice(0,10);
  return <>
    <section className="section-head transition-head"><div><span className="eyebrow">Turning Point & Catalyst Intelligence</span><h2>Regime stability before directional conviction</h2><p>Acceleration reversals, surprise persistence and dense event sequences are treated as transition risk. A strong current reading is not assumed to be a stable regime when its underlying momentum is reversing.</p></div></section>
    <section className="transition-grid">
      <article className="panel transition-economies">
        <div className="panel-title"><div><span className="eyebrow">Macro Turning Risk</span><h2>Economy transition map</h2></div><span>{turningPoints?.highRisk||0} high-risk families</span></div>
        <div className="transition-list">{economies.map(row=><div className="transition-row" key={row.economy}><div><strong>{row.economy.replaceAll('_',' ')}</strong><small>{pretty(row.direction)} · {row.highFamilies} high · {row.watchFamilies} watch</small></div><b className={riskClass(row.risk)}>{row.risk}</b><div className="transition-family-chips">{row.families.slice(0,3).map(f=><span key={f.family}>{pretty(f.family)} {f.risk}</span>)}</div></div>)}</div>
      </article>
      <article className="panel transition-catalysts">
        <div className="panel-title"><div><span className="eyebrow">Catalyst Sequencing</span><h2>Next {catalystSequence?.windowHours||72} hours</h2></div><span>{catalystSequence?.totalUpcoming||0} events</span></div>
        <div className="catalyst-list">{catalysts.map(row=><div className="catalyst-row" key={row.currency}><div><strong>{row.currency}</strong><small>{row.events} events · {row.highImpact} high impact · {row.clusters} clusters</small></div><b className={riskClass(row.densityScore)}>{row.densityScore}</b>{row.next[0]&&<span>{row.next[0].event} · {new Date(row.next[0].date).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>}</div>)}</div>
      </article>
    </section>
    <article className="panel persistence-panel">
      <div className="panel-title"><div><span className="eyebrow">Surprise Persistence</span><h2>Repeated economic-release direction</h2></div><span>{persistent.length} leading sequences</span></div>
      <div className="persistence-table">{persistent.map((row,index)=><div key={`${row.currency}-${row.family}-${index}`}><strong>{row.currency} · {pretty(row.family)}</strong><span>Streak <b className={row.streak>0?'positive':row.streak<0?'negative':'neutral'}>{signed(row.streak)}</b></span><span>Recent <b>{signed(row.recentMean,2)}</b></span><span>Acceleration <b className={row.acceleration>0?'positive':row.acceleration<0?'negative':'neutral'}>{signed(row.acceleration,2)}</b></span><span>{pretty(row.status)}</span></div>)}</div>
    </article>
  </>;
}
