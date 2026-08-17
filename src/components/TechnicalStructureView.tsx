import type { MarketQuote } from '../lib/types';
import './TechnicalStructureView.css';

type TechnicalState = 'bullish' | 'bearish' | 'balanced' | 'unavailable';
const num=(v?:number|null)=>typeof v==='number'&&Number.isFinite(v)?v:null;
function digits(a:MarketQuote){if(a.quoteKind==='yield')return 3;if(/JPY|ZAR|EUR|GBP|DXY/i.test(a.id))return 4;return (a.price??0)>=1000?2:3;}
function fmt(a:MarketQuote,v?:number|null){const n=num(v);return n==null?'—':n.toLocaleString(undefined,{maximumFractionDigits:digits(a)});}
function derive(a:MarketQuote){
  const price=num(a.price),open=num(a.open),high=num(a.high),low=num(a.low),prev=num(a.previousClose);
  if(price==null)return{state:'unavailable' as TechnicalState,location:null,zone:'Unavailable',rangePct:null,momentum:null,expansion:null};
  const state:TechnicalState=open!=null&&prev!=null?price>open&&price>prev?'bullish':price<open&&price<prev?'bearish':'balanced':prev!=null?price>prev?'bullish':price<prev?'bearish':'balanced':'balanced';
  const range=high!=null&&low!=null&&high>low?high-low:null;
  const location=range!=null?Math.max(0,Math.min(100,((price-low!)/range)*100)):null;
  const zone=location==null?'No range':location>=66.67?'Premium':location<=33.33?'Discount':'Equilibrium';
  const ref=prev??open;
  const momentum=ref!=null&&Math.abs(ref)>1e-12?((price-ref)/Math.abs(ref))*100:num(a.changePercent);
  const rangePct=range!=null&&prev!=null&&Math.abs(prev)>1e-12?(range/Math.abs(prev))*100:null;
  const expansion=range!=null&&ref!=null&&range>1e-12?Math.min(100,Math.abs(price-ref)/range*100):null;
  return{state,location,zone,rangePct,momentum,expansion};
}
function State({state}:{state:TechnicalState}){return <span className={`technical-state ${state}`}>{state==='balanced'?'Balanced':state==='unavailable'?'No quote':state[0].toUpperCase()+state.slice(1)}</span>;}

export function TechnicalStructureView({assets}:{assets:MarketQuote[]}){
  const rows=assets.filter(a=>num(a.price)!=null).map(asset=>({asset,technical:derive(asset)}));
  const bullish=rows.filter(x=>x.technical.state==='bullish').length,bearish=rows.filter(x=>x.technical.state==='bearish').length,balanced=rows.filter(x=>x.technical.state==='balanced').length;
  return <>
    <section className="technical-summary">
      <article className="panel technical-intro"><span className="eyebrow">Technical Market Context</span><h2>Structure, range location and directional confirmation.</h2><p>Current price is evaluated against the session open, prior close, high and low. Technical context remains separate from macro conviction so price action can confirm, reject or delay a directional thesis.</p></article>
      <article className="panel technical-breadth"><span className="eyebrow">Cross Asset Breadth</span><div className="technical-breadth-grid"><div><strong>{bullish}</strong><span>Bullish</span></div><div><strong>{bearish}</strong><span>Bearish</span></div><div><strong>{balanced}</strong><span>Balanced</span></div><div><strong>{rows.length}</strong><span>Live instruments</span></div></div></article>
    </section>
    <section className="section-head"><div><span className="eyebrow">Intraday Structure Board</span><h2>Range and liquidity references</h2><p>Premium and discount are calculated from the observed session range. High and low are transparent liquidity references, not guaranteed reversal levels.</p></div></section>
    <section className="technical-grid">{rows.map(({asset,technical})=><article className="technical-card" key={asset.id}>
      <div className="technical-card-head"><div><span className="eyebrow">{asset.assetClass?.replaceAll('-',' ')||'Market'}</span><h3>{asset.label}</h3><small>{asset.id}</small></div><State state={technical.state}/></div>
      <div className="technical-price-row"><strong>{fmt(asset,asset.price)}</strong><span className={(technical.momentum??0)>0?'positive':(technical.momentum??0)<0?'negative':'neutral'}>{technical.momentum==null?'—':`${technical.momentum>0?'+':''}${technical.momentum.toFixed(2)}%`}</span></div>
      <div className="range-track"><i className="range-third discount"></i><i className="range-third equilibrium"></i><i className="range-third premium"></i>{technical.location!=null?<b style={{left:`${technical.location}%`}}></b>:null}</div>
      <div className="technical-zone"><span>{technical.zone}</span><strong>{technical.location==null?'—':`${technical.location.toFixed(0)}% of range`}</strong></div>
      <div className="technical-levels"><div><small>Session high</small><b>{fmt(asset,asset.high)}</b></div><div><small>Session low</small><b>{fmt(asset,asset.low)}</b></div><div><small>Open</small><b>{fmt(asset,asset.open)}</b></div><div><small>Previous close</small><b>{fmt(asset,asset.previousClose)}</b></div></div>
      <div className="technical-diagnostics"><span>Range {technical.rangePct==null?'—':`${technical.rangePct.toFixed(2)}%`}</span><span>Expansion {technical.expansion==null?'—':`${technical.expansion.toFixed(0)}%`}</span><span>{asset.stale?'Last verified quote':'Live quote'}</span></div>
    </article>)}</section>
    <section className="panel technical-method"><div><span className="eyebrow">Structure Framework</span><h2>Multi timeframe execution architecture</h2></div><div className="technical-framework"><div><strong>Directional context</strong><span>Higher timeframe trend, strong and weak swing points, dealing range and premium or discount.</span></div><div><strong>Confirmation</strong><span>Liquidity interaction, order block response, change of character, displacement, structure break and imbalance confirmation.</span></div><div><strong>Execution</strong><span>Lower timeframe entry, invalidation, risk placement and staged profit objectives only after the parent context is confirmed.</span></div><div><strong>Advanced context</strong><span>Fair value gaps, inverse gaps, balanced price ranges, liquidity voids, sweeps, inducement, SMT, session timing and repricing.</span></div></div><small className="technical-disclaimer">Live cards use verified quote fields currently available. Full candle sequence validation is activated only when sufficient historical bars are available; missing structure is never invented.</small></section>
  </>;
}
