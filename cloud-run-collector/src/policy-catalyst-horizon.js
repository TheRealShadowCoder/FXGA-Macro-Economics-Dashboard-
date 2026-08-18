const DAY_MS=86_400_000;
const POLICY_CURRENCIES=new Set(['USD','EUR','GBP','ZAR','JPY']);
const POLICY_DECISION_RE=/\b(?:interest rate decision|rate decision|bank rate decision|repo rate decision|policy rate decision|cash rate decision|refinancing rate decision|deposit facility rate decision|fed funds rate decision|monetary policy decision)\b/i;
const normalize=value=>String(value||'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

export function isPolicyDecisionEvent(event){
  const currency=String(event?.currency||'').toUpperCase();
  if(!POLICY_CURRENCIES.has(currency))return false;
  return POLICY_DECISION_RE.test(`${event?.event||''} ${event?.category||''}`);
}
export function policyCatalystSegments(from,to,maxDays=30){
  const start=from instanceof Date?from.getTime():Date.parse(from),end=to instanceof Date?to.getTime():Date.parse(to),span=Math.max(1,Math.min(30,Number(maxDays)||30))*DAY_MS;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return [];
  const segments=[];let cursor=start;
  while(cursor<end){const segmentEnd=Math.min(end,cursor+span);segments.push({from:new Date(cursor),to:new Date(segmentEnd)});cursor=segmentEnd+1000;}
  return segments;
}
function sameEvent(a,b){
  if(String(a?.currency||'')!==String(b?.currency||''))return false;
  const ta=Date.parse(a?.date||''),tb=Date.parse(b?.date||'');if(!Number.isFinite(ta)||!Number.isFinite(tb)||Math.abs(ta-tb)>5*60_000)return false;
  const na=normalize(a?.event),nb=normalize(b?.event);return na===nb||na.includes(nb)||nb.includes(na);
}
export function mergePolicyCatalystEvents(primary=[],policyEvents=[]){
  const merged=(primary||[]).map(event=>({...event}));
  for(const candidate of policyEvents||[]){
    const match=merged.find(event=>sameEvent(event,candidate));
    if(!match){merged.push({...candidate});continue;}
    match.providers=[...new Set([...(match.providers||[]),...(candidate.providers||[])])];
    match.sourceCount=match.providers.length;
    match.policyCatalyst=Boolean(match.policyCatalyst||candidate.policyCatalyst);
    match.policyCatalystHorizonOnly=Boolean(match.policyCatalystHorizonOnly)&&Boolean(candidate.policyCatalystHorizonOnly);
    match.policyProvenance=match.policyProvenance||candidate.policyProvenance;
    match.actual??=candidate.actual;match.forecast??=candidate.forecast;match.previous??=candidate.previous;
  }
  return merged.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
}
