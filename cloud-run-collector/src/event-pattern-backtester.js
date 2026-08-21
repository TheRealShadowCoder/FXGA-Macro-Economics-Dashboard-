import { robustSummary, hitRateInterval, stabilityScore } from './research-statistics.js';
import { equityStats,bootstrapExpectancy,permutationSignificance,stressCosts } from './backtest-metrics.js';

const HORIZONS=['1m','5m','15m','30m','1h','2h','4h','8h','24h'];
const COST_BPS_BY_ASSET={EURUSD:1.5,GBPUSD:2,USDJPY:1.5,USDZAR:8,DXY:2,US2Y:2,US10Y:2,SPX:2,NASDAQ:2.5,DJI:2,VIX:5,GOLD:3,WTI:4,BRENT:4,BTCUSD:8,ETHUSD:10};
const clean=value=>String(value||'unknown').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'unknown';
const familyOf=study=>clean(study?.interpretationFamily||study?.category||study?.event||'event');
const primaryPattern=window=>{const patterns=Array.isArray(window?.patterns)?window.patterns:[];for(const candidate of ['breakout-up','breakout-down','bullish-trend','bearish-trend','compression','expansion','late-reversal-up','late-reversal-down','momentum-acceleration-up','momentum-acceleration-down','range-or-chop'])if(patterns.includes(candidate))return candidate;return patterns[0]||'unclassified';};
const reactionAt=(study,horizon,assetId)=>study?.horizons?.[horizon]?.reactions?.find(row=>row?.assetId===assetId&&row?.available);

const POOLING_TIERS=Object.freeze([
  {id:'T0',label:'event-currency-asset',fields:['eventFamily','currency','assetId']},
  {id:'T1',label:'plus-importance',fields:['eventFamily','currency','assetId','importance']},
  {id:'T2',label:'plus-pre-news-structure',fields:['eventFamily','currency','assetId','importance','preDirection','prePattern']},
  {id:'T3',label:'plus-session',fields:['eventFamily','currency','assetId','importance','preDirection','prePattern','sessionUtc']},
  {id:'T4',label:'plus-cross-asset-state',fields:['eventFamily','currency','assetId','importance','preDirection','prePattern','sessionUtc','crossState','volatilityState']},
]);
function tierKey(row,tier){return`${tier.id}|${tier.fields.map(field=>clean(row[field])).join('|')}`;}
function parentKey(row,tierIndex){return tierIndex>0?tierKey(row,POOLING_TIERS[tierIndex-1]):null;}

function observations(studies){
  const out=[];
  for(const study of studies){
    const cross=study?.preNews?.crossAsset||{};
    for(const asset of study?.preNews?.assets||[]){
      const anchor=asset?.windows?.['1h']?.available?asset.windows['1h']:asset?.windows?.['30m']?.available?asset.windows['30m']:asset?.windows?.['15m'];
      if(!anchor?.available)continue;
      for(const horizon of HORIZONS){
        const reaction=reactionAt(study,horizon,asset.assetId),move=Number(reaction?.rawMovePct);
        if(!reaction||!Number.isFinite(move))continue;
        out.push({eventId:study.eventId,releaseAt:study.releaseAt,assetId:asset.assetId,horizon,movePct:move,eventFamily:familyOf(study),currency:clean(study.currency),importance:`i${Number(study?.importance||0)}`,prePattern:primaryPattern(anchor),preDirection:asset.dominantDirection,sessionUtc:study?.timeSignature?.sessionUtc||'unknown',weekday:study?.timeSignature?.weekday||null,crossState:cross.state||'unknown',volatilityState:cross.volatilityState||'unknown'});
      }
    }
  }
  return out;
}
function normalCdf(x){const t=1/(1+.2316419*Math.abs(x)),d=.3989423*Math.exp(-x*x/2),p=1-d*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?p:1-p;}
function twoSidedSignP(successes,total){if(!total)return 1;const z=(Math.abs(successes-total/2)-.5)/Math.sqrt(total*.25);return Math.max(0,Math.min(1,2*(1-normalCdf(Math.max(0,z)))));}
function bhAdjust(rows){
  const sorted=rows.map(row=>({row,p:Math.max(Number(row.pValue??1),Number(row.permutationPValue??1))})).sort((a,b)=>a.p-b.p),m=sorted.length,q=new Array(m).fill(1);let next=1;
  for(let i=m-1;i>=0;i--){next=Math.min(next,sorted[i].p*m/(i+1));q[i]=next;}
  for(let i=0;i<m;i++){sorted[i].row.rawFdrPValue=Math.max(0,Math.min(1,sorted[i].p));sorted[i].row.qValue=Math.max(0,Math.min(1,q[i]));}
  return rows;
}
function validateGroup(rows,{holdoutFraction=.3,minTrain=12,minHoldout=5}={}){
  const ordered=[...rows].sort((a,b)=>Date.parse(a.releaseAt)-Date.parse(b.releaseAt));
  const split=Math.max(minTrain,Math.min(ordered.length-minHoldout,Math.floor(ordered.length*(1-holdoutFraction))));
  if(split<minTrain||ordered.length-split<minHoldout)return null;
  const train=ordered.slice(0,split),holdout=ordered.slice(split),trainMoves=train.map(x=>x.movePct),trainMean=robustSummary(trainMoves).mean,direction=Math.sign(trainMean||0);
  if(!direction)return null;
  const costBps=COST_BPS_BY_ASSET[rows[0].assetId]??3,costPct=costBps/100,score=sample=>direction*sample.movePct-costPct,holdoutDirectionalGross=holdout.map(x=>direction*x.movePct),holdoutNet=holdout.map(score),wins=holdoutNet.filter(x=>x>0).length,interval=hitRateInterval(wins,holdoutNet.length);
  const thirds=[0,1,2].map(part=>{const start=Math.floor(holdoutNet.length*part/3),end=Math.floor(holdoutNet.length*(part+1)/3),partRows=holdoutNet.slice(start,end);return partRows.length?robustSummary(partRows).mean:null;});
  const holdoutStats=robustSummary(holdoutNet),rawHoldout=robustSummary(holdoutDirectionalGross),risk=equityStats(holdoutNet),seed=`${rows[0].profileKey}|${rows[0].horizon}`,bootstrap=bootstrapExpectancy(holdoutNet,{iterations:1000,seed}),permutation=permutationSignificance(direction,holdout.map(x=>x.movePct),{iterations:1000,seed:`perm|${seed}`}),costStress=stressCosts(holdoutDirectionalGross,costPct);
  return{profileKey:rows[0].profileKey,parentProfileKey:rows[0].parentProfileKey,poolingTier:rows[0].poolingTier,poolingLabel:rows[0].poolingLabel,eventFamily:rows[0].eventFamily,currency:rows[0].currency,importance:rows[0].importance,assetId:rows[0].assetId,horizon:rows[0].horizon,prePattern:rows[0].prePattern,preDirection:rows[0].preDirection,sessionUtc:rows[0].sessionUtc,crossState:rows[0].crossState,volatilityState:rows[0].volatilityState,totalObservations:ordered.length,trainObservations:train.length,holdoutObservations:holdout.length,trainEndAt:train.at(-1)?.releaseAt||null,holdoutStartAt:holdout[0]?.releaseAt||null,direction:direction>0?'long':'short',costBps,trainMeanDirectionalMovePct:Number((direction*(trainMean||0)).toFixed(6)),holdoutGrossMeanDirectionalMovePct:Number((rawHoldout.mean||0).toFixed(6)),holdoutNetMeanPct:Number((holdoutStats.mean||0).toFixed(6)),holdoutMedianNetPct:Number((holdoutStats.median||0).toFixed(6)),holdoutNet95Low:Number.isFinite(holdoutStats.mean95Low)?Number(holdoutStats.mean95Low.toFixed(6)):null,holdoutNet95High:Number.isFinite(holdoutStats.mean95High)?Number(holdoutStats.mean95High.toFixed(6)):null,winRate:Number((wins/holdout.length).toFixed(4)),winRate95Low:interval.low==null?null:Number(interval.low.toFixed(4)),winRate95High:interval.high==null?null:Number(interval.high.toFixed(4)),temporalStability:stabilityScore(thirds),pValue:twoSidedSignP(wins,holdout.length),permutationPValue:permutation.pValue,qValue:null,risk,bootstrap,costStress,promotionEligible:false,validationStatus:'pending-fdr'};
}
function buildHierarchicalGroups(rows){
  const groups=new Map();
  for(const row of rows){
    for(let tierIndex=0;tierIndex<POOLING_TIERS.length;tierIndex++){
      const tier=POOLING_TIERS[tierIndex],profileKey=tierKey(row,tier),key=`${profileKey}|${row.horizon}`;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push({...row,profileKey,parentProfileKey:parentKey(row,tierIndex),poolingTier:tier.id,poolingLabel:tier.label});
    }
  }
  return groups;
}
export function backtestEventPatterns(studies=[],options={}){
  const rows=observations(studies),groups=buildHierarchicalGroups(rows),tests=[];
  for(const group of groups.values()){const result=validateGroup(group,options);if(result)tests.push(result);}
  bhAdjust(tests);
  const byKey=new Map(tests.map(test=>[`${test.profileKey}|${test.horizon}`,test]));
  for(const test of tests){
    const stable=Number(test.temporalStability??0)>=.35,positive=Number(test.holdoutNetMeanPct)>0,hit=Number(test.winRate)>=.55,fdr=Number(test.qValue)<=.10,perm=Number(test.permutationPValue??1)<=.10,bootstrap=Number(test.bootstrap?.positiveProbability??0)>=.80,costRobust=Array.isArray(test.costStress)&&test.costStress.slice(0,3).every(row=>row.positive),drawdown=Number(test.risk?.maxDrawdownPctPoints??Infinity)<=Math.max(1,Math.abs(Number(test.risk?.totalNetPct||0))*1.5),lower=Number(test.holdoutNet95Low)>-Math.abs(Number(test.holdoutNetMeanPct))*1.5;
    const parent=test.parentProfileKey?byKey.get(`${test.parentProfileKey}|${test.horizon}`):null,parentSupport=!test.parentProfileKey||Boolean(parent&&parent.direction===test.direction&&Number(parent.holdoutNetMeanPct)>=0);
    test.promotionEligible=Boolean(test.holdoutObservations>=8&&stable&&positive&&hit&&fdr&&perm&&bootstrap&&costRobust&&drawdown&&lower&&parentSupport);
    test.validationStatus=test.promotionEligible?'validated-candidate':'not-promoted';
    test.promotionChecks={holdout:test.holdoutObservations>=8,stable,positive,hit,fdr,permutation:perm,bootstrap,costRobust,drawdown,confidenceInterval:lower,parentSupport};
    test.hierarchy={tier:test.poolingTier,parentProfileKey:test.parentProfileKey,parentAvailable:Boolean(parent),parentDirection:parent?.direction??null,parentNetMeanPct:parent?.holdoutNetMeanPct??null};
  }
  tests.sort((a,b)=>Number(b.promotionEligible)-Number(a.promotionEligible)||Number(a.qValue)-Number(b.qValue)||b.holdoutObservations-a.holdoutObservations||a.poolingTier.localeCompare(b.poolingTier));
  const byTier=Object.fromEntries(POOLING_TIERS.map(tier=>[tier.id,{label:tier.label,tests:tests.filter(test=>test.poolingTier===tier.id).length,validatedCandidates:tests.filter(test=>test.poolingTier===tier.id&&test.promotionEligible).length}]));
  return{schema:'fxga.event-pattern-backtest.v3',generatedAt:new Date().toISOString(),methodology:'Hierarchical chronological train/holdout validation. Broad event/currency/asset populations are tested before increasingly specific importance, pre-news, session and cross-asset states. Direction is learned only from training data. Holdout results apply asset-level round-trip cost assumptions, equity/drawdown statistics, deterministic bootstrap expectancy, permutation testing, multi-cost stress, sign-test p-values and Benjamini-Hochberg FDR using the more conservative of sign/permutation p-values. Specific candidates require parent-direction support. A validated-candidate is not a profitability guarantee and remains subject to walk-forward, paper-trade and live execution calibration.',horizons:HORIZONS,poolingTiers:POOLING_TIERS,totalObservations:rows.length,hierarchicalHypotheses:groups.size,tests:tests.length,validatedCandidates:tests.filter(x=>x.promotionEligible).length,testsByTier:byTier,assumptions:{holdoutFraction:options.holdoutFraction??.3,minTrain:options.minTrain??12,minHoldout:options.minHoldout??5,costBpsByAsset:COST_BPS_BY_ASSET,bootstrapIterations:1000,permutationIterations:1000,profitabilityClaims:false,parentSupportRequired:true,fdrPValue:'max(sign-test, permutation-test)'},topTests:tests.slice(0,500)};
}
