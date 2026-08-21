import { robustSummary, hitRateInterval, sampleGrade, stabilityScore } from './research-statistics.js';

const HORIZONS=['1m','5m','15m','30m','1h','2h','4h','8h','24h'];
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const sign=value=>Math.abs(Number(value||0))<1e-12?0:Number(value)>0?1:-1;
const round=(value,digits=5)=>Number.isFinite(Number(value))?Number(Number(value).toFixed(digits)):null;
const clean=value=>String(value||'unknown').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'unknown';

function familyOf(study){return clean(study?.interpretationFamily||study?.category||study?.event||'event');}
function primaryPattern(window){
  const patterns=Array.isArray(window?.patterns)?window.patterns:[];
  for(const candidate of ['breakout-up','breakout-down','bullish-trend','bearish-trend','compression','expansion','late-reversal-up','late-reversal-down','momentum-acceleration-up','momentum-acceleration-down','range-or-chop'])if(patterns.includes(candidate))return candidate;
  return patterns[0]||'unclassified';
}
function reactionAt(study,horizon,assetId){return study?.horizons?.[horizon]?.reactions?.find(row=>row?.assetId===assetId&&row?.available);}
function profileKey(study,asset,anchor){
  const time=study?.timeSignature||{},cross=study?.preNews?.crossAsset||{};
  return [familyOf(study),clean(study?.currency),`i${Number(study?.importance||0)}`,clean(time.sessionUtc),clean(time.weekday),clean(asset.assetId),clean(asset.dominantDirection),clean(primaryPattern(anchor)),clean(cross.state),clean(cross.volatilityState)].join('|');
}
function observation(study,asset){
  const anchor=asset?.windows?.['1h']?.available?asset.windows['1h']:asset?.windows?.['30m']?.available?asset.windows['30m']:asset?.windows?.['15m'];if(!anchor?.available)return null;
  const post={};for(const horizon of HORIZONS){const reaction=reactionAt(study,horizon,asset.assetId);if(reaction)post[horizon]={movePct:finite(reaction.rawMovePct),maxUpsidePct:finite(reaction.maxUpsidePct),maxDownsidePct:finite(reaction.maxDownsidePct),rangePct:finite(reaction.rangePct)};}
  return{key:profileKey(study,asset,anchor),eventId:study.eventId,event:study.event,eventFamily:familyOf(study),currency:study.currency,importance:Number(study.importance||0),releaseAt:study.releaseAt,dateUtc:study.releaseDateUtc||study?.timeSignature?.dateUtc||null,weekday:study?.timeSignature?.weekday||null,isoWeek:study?.timeSignature?.isoWeek??null,sessionUtc:study?.timeSignature?.sessionUtc||null,hourUtc:study?.timeSignature?.hourUtc??null,assetId:asset.assetId,preDirection:asset.dominantDirection,prePattern:primaryPattern(anchor),prePatternSet:anchor.patterns||[],preMovePct:finite(anchor.movePct),preRangePct:finite(anchor.rangePct),preAtrPct:finite(anchor.atrPct),preTrendR2:finite(anchor.trendR2),preEfficiency:finite(anchor.efficiencyRatio),preCloseLocation:finite(anchor.closeLocation),preVolumeAcceleration:finite(anchor.volumeAcceleration),preSpreadAcceleration:finite(anchor.spreadAcceleration),crossAssetState:study?.preNews?.crossAsset?.state||null,crossAssetVolatilityState:study?.preNews?.crossAsset?.volatilityState||null,actual:study.actual??null,forecast:study.forecast??null,surprisePercent:finite(study.surprisePercent),post};
}
function aggregateHorizon(rows,horizon){
  const samples=rows.map(row=>row.post?.[horizon]).filter(Boolean),moves=samples.map(row=>row.movePct).filter(Number.isFinite),up=moves.filter(value=>value>0).length,down=moves.filter(value=>value<0).length,flat=moves.length-up-down,continuation=rows.filter(row=>{const value=row.post?.[horizon]?.movePct;if(!Number.isFinite(value))return false;const pre=sign(row.preMovePct),post=sign(value);return pre!==0&&pre===post;}).length,reversal=rows.filter(row=>{const value=row.post?.[horizon]?.movePct;if(!Number.isFinite(value))return false;const pre=sign(row.preMovePct),post=sign(value);return pre!==0&&post!==0&&pre!==post;}).length;
  const moveStats=robustSummary(moves),up95=hitRateInterval(up,moves.length),continuation95=hitRateInterval(continuation,moves.length),reversal95=hitRateInterval(reversal,moves.length);
  const chronological=[...rows].sort((a,b)=>Date.parse(a.releaseAt)-Date.parse(b.releaseAt));
  const thirds=[0,1,2].map(part=>{const start=Math.floor(chronological.length*part/3),end=Math.floor(chronological.length*(part+1)/3),slice=chronological.slice(start,end),vals=slice.map(row=>row.post?.[horizon]?.movePct).filter(Number.isFinite);return vals.length?robustSummary(vals).mean:null;});
  return{
    observations:moves.length,
    meanMovePct:round(moveStats.mean),medianMovePct:round(moveStats.median),trimmedMeanMovePct:round(moveStats.trimmedMean),
    meanMove95Low:round(moveStats.mean95Low),meanMove95High:round(moveStats.mean95High),stddevMovePct:round(moveStats.stddev),madMovePct:round(moveStats.mad),iqrMovePct:round(moveStats.iqr),q10MovePct:round(moveStats.q10),q90MovePct:round(moveStats.q90),signEffect:round(moveStats.signEffect,4),
    meanAbsoluteMovePct:round(robustSummary(moves.map(Math.abs)).mean),
    upRate:moves.length?round(up/moves.length,4):null,upRate95Low:round(up95.low,4),upRate95High:round(up95.high,4),
    downRate:moves.length?round(down/moves.length,4):null,flatRate:moves.length?round(flat/moves.length,4):null,
    continuationRate:moves.length?round(continuation/moves.length,4):null,continuation95Low:round(continuation95.low,4),continuation95High:round(continuation95.high,4),
    reversalRate:moves.length?round(reversal/moves.length,4):null,reversal95Low:round(reversal95.low,4),reversal95High:round(reversal95.high,4),
    meanMaxUpsidePct:round(robustSummary(samples.map(row=>row.maxUpsidePct)).mean),meanMaxDownsidePct:round(robustSummary(samples.map(row=>row.maxDownsidePct)).mean),meanRangePct:round(robustSummary(samples.map(row=>row.rangePct)).mean),
    temporalStability:round(stabilityScore(thirds),4),sampleGrade:sampleGrade(moves.length,{oos:false,stable:false})
  };
}
function aggregateGroup(rows){
  const first=rows[0],horizons={};for(const horizon of HORIZONS)horizons[horizon]=aggregateHorizon(rows,horizon);
  const sampleStatus=sampleGrade(rows.length,{oos:false,stable:false});
  const preMove=robustSummary(rows.map(row=>row.preMovePct)),preRange=robustSummary(rows.map(row=>row.preRangePct)),preAtr=robustSummary(rows.map(row=>row.preAtrPct));
  return{profileKey:first.key,eventFamily:first.eventFamily,currency:first.currency,importance:first.importance,assetId:first.assetId,sessionUtc:first.sessionUtc,weekday:first.weekday,preDirection:first.preDirection,prePattern:first.prePattern,crossAssetState:first.crossAssetState,crossAssetVolatilityState:first.crossAssetVolatilityState,observations:rows.length,uniqueEvents:new Set(rows.map(row=>row.eventId)).size,sampleStatus,
    validation:{outOfSample:false,multipleTestingControlled:false,transactionCostsApplied:false,promotionEligible:false,reason:'Descriptive research only until an explicit out-of-sample validation workflow is completed.'},
    preNews:{meanMovePct:round(preMove.mean),medianMovePct:round(preMove.median),trimmedMeanMovePct:round(preMove.trimmedMean),meanMove95Low:round(preMove.mean95Low),meanMove95High:round(preMove.mean95High),meanRangePct:round(preRange.mean),meanAtrPct:round(preAtr.mean),meanTrendR2:round(robustSummary(rows.map(row=>row.preTrendR2)).mean),meanEfficiency:round(robustSummary(rows.map(row=>row.preEfficiency)).mean,4),meanCloseLocation:round(robustSummary(rows.map(row=>row.preCloseLocation)).mean,4),meanVolumeAcceleration:round(robustSummary(rows.map(row=>row.preVolumeAcceleration)).mean,4),meanSpreadAcceleration:round(robustSummary(rows.map(row=>row.preSpreadAcceleration)).mean,4)},horizons};
}

export function buildEventPatternProfiles(studies=[]){
  const observations=[];for(const study of studies){for(const asset of study?.preNews?.assets||[]){const row=observation(study,asset);if(row)observations.push(row);}}
  const groups=new Map();for(const row of observations){if(!groups.has(row.key))groups.set(row.key,[]);groups.get(row.key).push(row);}
  const profiles=[...groups.values()].map(aggregateGroup).sort((a,b)=>b.observations-a.observations||String(a.profileKey).localeCompare(String(b.profileKey))).slice(0,750);
  const recurring=profiles.filter(profile=>profile.observations>=3),researchReady=profiles.filter(profile=>profile.observations>=20);
  return{generatedAt:new Date().toISOString(),methodology:'deterministic pre-news M1 price-action signatures grouped by event family, currency, importance, UTC session, weekday, asset, pre-release direction/pattern and cross-asset regime; robust summaries, confidence intervals and temporal-stability diagnostics are descriptive until explicit out-of-sample validation succeeds',horizons:HORIZONS,observations:observations.length,profiles:profiles.length,recurringProfiles:recurring.length,researchReadyProfiles:researchReady.length,samplePolicy:{insufficient:'1-2 observations',early:'3-9 observations',developing:'10-19 observations',researchReady:'20+ observations; still requires explicit out-of-sample validation, multiple-testing control and execution-cost robustness'},researchGovernance:{profitabilityClaims:false,outOfSampleRequired:true,multipleTestingControlRequired:true,transactionCostRobustnessRequired:true,rawEventProvenanceRequired:true},topProfiles:profiles};
}
