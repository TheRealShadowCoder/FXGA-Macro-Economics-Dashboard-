import { useMemo, useState } from 'react';
import { RESEARCH_SOURCE_NETWORK } from '../source-network';
import './SourceNetworkView.css';

type ActiveSource={id:string;name:string;category:string;region:string;status:string;note?:string};
const label=(v:string)=>v.replaceAll('_',' ').replace(/\b\w/g,m=>m.toUpperCase());

export function SourceNetworkView({activeSources}:{activeSources:ActiveSource[]}){
  const [query,setQuery]=useState(''),[kind,setKind]=useState('all');
  const kinds=useMemo(()=>['all',...new Set(RESEARCH_SOURCE_NETWORK.map(s=>s.kind))],[ ]);
  const activeNames=useMemo(()=>new Set(activeSources.map(s=>s.name.toLowerCase())),[activeSources]);
  const filtered=useMemo(()=>RESEARCH_SOURCE_NETWORK.filter(s=>{
    const hay=`${s.name} ${s.domain} ${s.kind} ${s.country} ${s.currency}`.toLowerCase();
    return (kind==='all'||s.kind===kind)&&(!query||hay.includes(query.toLowerCase()));
  }),[query,kind]);
  const official=RESEARCH_SOURCE_NETWORK.filter(s=>s.kind.startsWith('official')||s.kind==='central_bank'||s.kind==='central_bank_research').length;
  const metadata=RESEARCH_SOURCE_NETWORK.filter(s=>s.metadataOnly).length;
  return <>
    <section className="source-network-summary panel">
      <div><span className="eyebrow">Institutional Research Network</span><h2>83-source coverage registry</h2><p>This registry preserves the research-source universe from the desktop platform. A source can be registered for research coverage without being treated as a live collector. Access-restricted publishers remain metadata-only and no access controls are bypassed.</p></div>
      <div className="source-network-stats"><div><strong>{RESEARCH_SOURCE_NETWORK.length}</strong><span>Registered sources</span></div><div><strong>{official}</strong><span>Official / central bank</span></div><div><strong>{metadata}</strong><span>Metadata only</span></div><div><strong>{activeSources.length}</strong><span>Live application groups</span></div></div>
    </section>
    <section className="source-network-controls"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search source, country, currency or domain" aria-label="Search research source network"/><select value={kind} onChange={e=>setKind(e.target.value)} aria-label="Filter research source type">{kinds.map(k=><option value={k} key={k}>{k==='all'?'All source types':label(k)}</option>)}</select><span>{filtered.length} results</span></section>
    <section className="source-network-grid">{filtered.map(source=>{const live=activeNames.has(source.name.toLowerCase())||activeSources.some(s=>source.name.toLowerCase().includes(s.name.toLowerCase())||s.name.toLowerCase().includes(source.name.toLowerCase()));return <article className="source-network-card" key={source.key}><div className="source-network-card-head"><div><span className="eyebrow">{source.currency||source.country}</span><h3>{source.name}</h3></div><span className={`registry-mode ${live?'live':source.metadataOnly?'metadata':'registered'}`}>{live?'live':source.metadataOnly?'metadata':'registered'}</span></div><p>{source.domain}</p><div className="source-network-meta"><span>{label(source.kind)}</span><span>{source.country}</span><span>Quality {Math.round(source.quality*100)}</span></div>{source.metadataOnly&&<small>Public metadata only. No paywall or access-control bypass.</small>}</article>})}</section>
  </>;
}
