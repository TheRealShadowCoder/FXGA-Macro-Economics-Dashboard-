const HORIZONS=['1m','5m','15m','30m','1h','2h','4h','8h','24h'];
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const sign=value=>Math.abs(Number(value||0))<1e-12?0:Number(value)>0?1:-1;
const mean=values=>{const rows=values.filter(Number.isFinite);return rows.length?rows.reduce((sum,value)=>sum+value,0)/rows.length:null;};
const median=values=>{const rows=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!rows.length)return null;const mid=Math.floor(rows.length/2);return rows.length%2?rows[mid]:(rows[mid-1]+rows[mid])/2;};
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
  return{observations:moves.length,meanMovePct:round(mean(moves)),medianMovePct:round(median(moves)),meanAbsoluteMovePct:round(mean(moves.map(Math.abs))),upRate:moves.length?round(up/moves.length,4):null,downRate:moves.length?round(down/moves.length,4):null,flatRate:moves.length?round(flat/moves.length,4):null,continuationRate:moves.length?round(continuation/moves.length,4):null,reversalRate:moves.length?round(reversal/moves.length,4):null,meanMaxUpsidePct:round(mean(samples.map(row=>row.maxUpsidePct))),meanMaxDownsidePct:round(mean(samples.map(row=>row.maxDownsidePct))),meanRangePct:round(mean(samples.map(row=>row.rangePct)))};
}
function aggregateGroup(rows){
  const first=rows[0],horizons={};for(const horizon of HORIZONS)horizons[horizon]=aggregateHorizon(rows,horizon);const sampleStatus=rows.length>=20?'research-ready':rows.length>=10?'developing':rows.length>=3?'early-sample':'insufficient-sample';
  return{profileKey:first.key,eventFamily:first.eventFamily,currency:first.currency,importance:first.importance,assetId:first.assetId,sessionUtc:first.sessionUtc,weekday:first.weekday,preDirection:first.preDirection,prePattern:first.prePattern,crossAssetState:first.crossAssetState,crossAssetVolatilityState:first.crossAssetVolatilityState,observations:rows.length,uniqueEvents:new Set(rows.map(row=>row.eventId)).size,sampleStatus,preNews:{meanMovePct:round(mean(rows.map(row=>row.preMovePct))),medianMovePct:round(median(rows.map(row=>row.preMovePct))),meanRangePct:round(mean(rows.map(row=>row.preRangePct))),meanAtrPct:round(mean(rows.map(row=>row.preAtrPct))),meanTrendR2:round(mean(rows.map(row=>row.preTrendR2))),meanEfficiency:round(mean(rows.map(row=>row.preEfficiency)),4),meanCloseLocation:round(mean(rows.map(row=>row.preCloseLocation)),4),meanVolumeAcceleration:round(mean(rows.map(row=>row.preVolumeAcceleration)),4),meanSpreadAcceleration:round(mean(rows.map(row=>row.preSpreadAcceleration)),4)},horizons};
}

export function buildEventPatternProfiles(studies=[]){
  const observations=[];for(const study of studies){for(const asset of study?.preNews?.assets||[]){const row=observation(study,asset);if(row)observations.push(row);}}
  const groups=new Map();for(const row of observations){if(!groups.has(row.key))groups.set(row.key,[]);groups.get(row.key).push(row);}
  const profiles=[...groups.values()].map(aggregateGroup).sort((a,b)=>b.observations-a.observations||String(a.profileKey).localeCompare(String(b.profileKey))).slice(0,750);
  const recurring=profiles.filter(profile=>profile.observations>=3),researchReady=profiles.filter(profile=>profile.observations>=20);
  return{generatedAt:new Date().toISOString(),methodology:'deterministic pre-news M1 price-action signatures grouped by event family, currency, importance, UTC session, weekday, asset, pre-release direction/pattern and cross-asset regime; outcomes remain descriptive until sufficient out-of-sample evidence exists',horizons:HORIZONS,observations:observations.length,profiles:profiles.length,recurringProfiles:recurring.length,researchReadyProfiles:researchReady.length,samplePolicy:{insufficient:'1-2 observations',early:'3-9 observations',developing:'10-19 observations',researchReady:'20+ observations; still requires out-of-sample validation'},topProfiles:profiles};
}
