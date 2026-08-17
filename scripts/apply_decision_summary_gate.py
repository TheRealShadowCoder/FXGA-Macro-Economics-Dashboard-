from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

worker=ROOT/'worker/index-v3.ts'
text=worker.read_text(encoding='utf-8')
old="const originalSummary=intel.sessionSignals.decisionSummary??{};const originalTop=originalSummary?.topOpportunity;const topOpportunity=originalTop?{...originalTop,...(rankedBySymbol.get(String(originalTop.symbol||'').toUpperCase())??{})}:rankedOpportunities[0]??null;return json({...intel.sessionSignals,sessions,rankedOpportunities,decisionSummary:{...originalSummary,topOpportunity},economyObservationCount:observations.length,technicalGeneratedAt:s.technical?.generatedAt??null});"
new="const originalSummary=intel.sessionSignals.decisionSummary??{};const originalTop=originalSummary?.topOpportunity;const topOpportunity=originalTop?{...originalTop,...(rankedBySymbol.get(String(originalTop.symbol||'').toUpperCase())??{})}:rankedOpportunities[0]??null;const technicalExecutableCount=rankedOpportunities.filter((item:any)=>item.executionGate==='TECHNICAL_CONFIRMATION_PASSED').length;const macroCandidateCount=Number(originalSummary.actionableCount??rankedOpportunities.filter((item:any)=>String(item.direction||'WAIT')!=='WAIT').length);return json({...intel.sessionSignals,sessions,rankedOpportunities,decisionSummary:{...originalSummary,macroCandidateCount,technicalExecutableCount,actionableCount:technicalExecutableCount,topOpportunity},economyObservationCount:observations.length,technicalGeneratedAt:s.technical?.generatedAt??null});"
if old not in text: raise SystemExit('Decision-summary worker anchor missing')
worker.write_text(text.replace(old,new,1),encoding='utf-8')

component=ROOT/'src/components/DecisionIntelligence.tsx'
text=component.read_text(encoding='utf-8')
old="decisionSummary?:{actionableCount:number;waitCount?:number;strongestCurrency:string|null;weakestCurrency:string|null;topOpportunity?:{symbol:string;direction:'BUY'|'SELL'|'WAIT';score:number;confidence:number;conviction:number;executionGate:string}|null}};"
new="decisionSummary?:{actionableCount:number;macroCandidateCount?:number;technicalExecutableCount?:number;waitCount?:number;strongestCurrency:string|null;weakestCurrency:string|null;topOpportunity?:{symbol:string;direction:'BUY'|'SELL'|'WAIT';score:number;confidence:number;conviction:number;executionGate:string}|null}};"
if old not in text: raise SystemExit('Decision-summary type anchor missing')
text=text.replace(old,new,1)
old="<div><small>Actionable</small><strong>{summary?.actionableCount??0}</strong></div><div><small>WAIT</small><strong>{summary?.waitCount??0}</strong></div>"
new="<div><small>Confirmed</small><strong>{summary?.technicalExecutableCount??summary?.actionableCount??0}</strong></div><div><small>Macro candidates</small><strong>{summary?.macroCandidateCount??0}</strong></div>"
if old not in text: raise SystemExit('Decision-summary KPI anchor missing')
component.write_text(text.replace(old,new,1),encoding='utf-8')
print('Decision summary now counts only technically confirmed opportunities as actionable.')
