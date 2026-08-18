const clamp=(v,min=-1,max=1)=>Math.max(min,Math.min(max,Number.isFinite(Number(v))?Number(v):0));
const FEATURES=[
  {id:'refinedScore',label:'Refined score alignment',mode:'directional',scale:100},
  {id:'directionalProbability',label:'Directional probability',mode:'higher',scale:1},
  {id:'evidenceQuality',label:'Evidence quality',mode:'higher',scale:100},
  {id:'uncertainty',label:'Low uncertainty',mode:'lower',scale:100},
  {id:'scenarioRobustness',label:'Scenario robustness',mode:'higher',scale:100},
  {id:'contradictions',label:'Low contradiction count',mode:'lower',scale:5},
  {id:'reactionGap',label:'Reaction-function alignment',mode:'directional',scale:100},
  {id:'crossAssetScore',label:'Cross-asset alignment',mode:'directional',scale:100},
  {id:'evidenceCompleteness',label:'Evidence completeness',mode:'higher',scale:100},
  {id:'releaseDifferential',label:'Release-sequence alignment',mode:'directional',scale:100},
  {id:'revisionDifferential',label:'Revision alignment',mode:'directional',scale:100},
  {id:'communicationGap',label:'Low communication gap',mode:'lower',scale:100},
  {id:'transitionRisk',label:'Low transition risk',mode:'lower',scale:100},
  {id:'structuralBreakRisk',label:'Low structural-break risk',mode:'lower',scale:100},
  {id:'independenceRatio',label:'Evidence independence',mode:'higher',scale:1},
  {id:'modelHealth',label:'Model health',mode:'higher',scale:100},
  {id:'counterfactualShift',label:'Counterfactual robustness',mode:'higher',scale:100},
  {id:'causalNet',label:'Causal-transmission alignment',mode:'directional',scale:100},
  {id:'eventReactionFactor',label:'Event-reaction confidence calibration',mode:'centered',center:1,scale:.14},
];
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
function chosenOutcome(row){return row?.outcomes?.h4||row?.outcomes?.h1||row?.outcomes?.h24||row?.outcomes?.m15||null;}
function qualityValue(feature,row){const raw=Number(row?.featureVector?.[feature.id]);if(!Number.isFinite(raw))return null;const direction=String(row?.direction||'').toUpperCase()==='SELL'?-1:1;if(feature.mode==='directional')return clamp(direction*raw/feature.scale);if(feature.mode==='lower')return clamp(1-2*Math.max(0,Math.min(1,raw/feature.scale)));if(feature.mode==='centered')return clamp((raw-Number(feature.center||0))/feature.scale);return clamp(2*Math.max(0,Math.min(1,raw/feature.scale))-1);}
function correlation(xs,ys){if(xs.length<3)return 0;const mx=mean(xs),my=mean(ys),dx=xs.map(x=>x-mx),dy=ys.map(y=>y-my),num=dx.reduce((s,x,i)=>s+x*dy[i],0),den=Math.sqrt(dx.reduce((s,x)=>s+x*x,0)*dy.reduce((s,y)=>s+y*y,0));return den>1e-12?num/den:0;}
function rowsFromMemory(memory){const rows=[];for(const [symbol,items] of Object.entries(memory?.analogueLibrary||{}))for(const item of items||[]){const outcome=chosenOutcome(item);if(!outcome||!Number.isFinite(Number(outcome.signedBps))||!item.featureVector)continue;rows.push({...item,symbol,outcome});}return rows;}
function attributionFor(rows,feature){const selected=[];for(const row of rows){const value=qualityValue(feature,row);if(value==null)continue;selected.push({value,outcome:Math.tanh(Number(row.outcome.signedBps)/25),bps:Number(row.outcome.signedBps)});}const samples=selected.length;if(!samples)return {id:feature.id,label:feature.label,samples:0,association:0,shrunkAssociation:0,status:'unproven',topMinusBottomBps:null};const values=selected.map(x=>x.value),outcomes=selected.map(x=>x.outcome),association=correlation(values,outcomes),shrink=samples/(samples+14),shrunk=association*shrink,ordered=[...selected].sort((a,b)=>a.value-b.value),bucket=Math.max(1,Math.floor(ordered.length/3)),bottom=ordered.slice(0,bucket),top=ordered.slice(-bucket),spread=mean(top.map(x=>x.bps))-mean(bottom.map(x=>x.bps)),status=samples<8?'unproven':shrunk>=.10?'helpful':shrunk<=-.10?'harmful':'mixed';return {id:feature.id,label:feature.label,samples,association:Number(association.toFixed(4)),shrunkAssociation:Number(shrunk.toFixed(4)),status,topMinusBottomBps:Number(spread.toFixed(2))};}
function summarize(rows){const features=FEATURES.map(feature=>attributionFor(rows,feature)),ranked=[...features].sort((a,b)=>Math.abs(b.shrunkAssociation)-Math.abs(a.shrunkAssociation));return {samples:rows.length,features,mostHelpful:ranked.filter(x=>x.status==='helpful').slice(0,5),mostHarmful:ranked.filter(x=>x.status==='harmful').slice(0,5),unproven:features.filter(x=>x.status==='unproven').length};}

export function buildDecisionQualityAttribution(decisionMemory){
  const rows=rowsFromMemory(decisionMemory),global=summarize(rows),bySymbol={};for(const symbol of new Set(rows.map(x=>x.symbol))){const subset=rows.filter(x=>x.symbol===symbol);if(subset.length>=6)bySymbol[symbol]=summarize(subset);}
  return {generatedAt:new Date().toISOString(),sampledRealizedStates:rows.length,global,bySymbol,methodology:'Association attribution over prior frozen decision states with realized market outcomes. Directional features are oriented to the frozen trade direction; risk features are inverted so higher normalized values mean better modeled conditions. Pearson associations are shrunk toward zero for small samples. Results describe historical association, not causal contribution, and do not directly vote on current direction.'};
}
