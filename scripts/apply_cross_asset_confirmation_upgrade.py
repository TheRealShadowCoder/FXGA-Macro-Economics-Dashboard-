from pathlib import Path


def replace_once(text,old,new,label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return text.replace(old,new,1)

path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')

anchor="function marketAssetSignal(symbol,marketData){\n"
if 'function crossAssetConfirmation(' not in text:
    fn="""function crossAssetFactor(marketData,id,scale=.45){
  const asset=findMarketAsset(marketData,id);if(!asset)return {available:false,id,score:0,changePercent:null};const change=Number(asset.changePercent);if(!Number.isFinite(change))return {available:false,id,score:0,changePercent:null};return {available:true,id,score:100*Math.tanh(change/scale),changePercent:change};
}
function crossAssetConfirmation(symbol,marketData){
  const factors={dxy:crossAssetFactor(marketData,'DXY',.35),us2y:crossAssetFactor(marketData,'US2Y',.45),us10y:crossAssetFactor(marketData,'US10Y',.45),spx:crossAssetFactor(marketData,'SPX',.55),nasdaq:crossAssetFactor(marketData,'NASDAQ',.65),vix:crossAssetFactor(marketData,'VIX',2.2),gold:crossAssetFactor(marketData,'GOLD',.55)},s=String(symbol||'').toUpperCase();
  const templates={EURUSD:{dxy:-.55,us2y:-.25,spx:.10,vix:-.10},GBPUSD:{dxy:-.55,us2y:-.25,spx:.10,vix:-.10},USDJPY:{dxy:.40,us2y:.35,spx:.15,vix:-.10},USDZAR:{dxy:.35,us2y:.15,spx:-.20,vix:.30},EURZAR:{spx:-.30,vix:.45,dxy:.10,us2y:.15},GBPZAR:{spx:-.30,vix:.45,dxy:.10,us2y:.15},EURGBP:{dxy:0,us2y:0,spx:0,vix:0},XAUUSD:{dxy:-.35,us10y:-.30,vix:.25,spx:-.10}};
  const weights=templates[s]||{},used=[];let numerator=0,denominator=0;for(const [id,weight] of Object.entries(weights)){if(!weight)continue;const factor=factors[id];if(!factor?.available)continue;numerator+=factor.score*weight;denominator+=Math.abs(weight);used.push({id,weight,score:Number(factor.score.toFixed(2)),changePercent:factor.changePercent});}const score=denominator?numerator/denominator:0;return {symbol:s,available:used.length>=2,score:Number(score.toFixed(2)),used,availableFactors:used.length,status:used.length<2?'insufficient':score>=25?'bullish-confirmation':score<=-25?'bearish-confirmation':'mixed'};
}
"""
    text=replace_once(text,anchor,fn+anchor,'cross asset functions')

# Final confidence uses alignment, not raw cross-asset score as a duplicate primary score.
if 'crossAssetFactorValue=Number(controls?.crossAsset?.factor||1)' not in text:
    text=replace_once(text,
        "changeFactor=Number(controls?.decisionChange?.factor||1),",
        "changeFactor=Number(controls?.decisionChange?.factor||1),crossAssetFactorValue=Number(controls?.crossAsset?.factor||1),",
        'cross asset factor declaration')
    text=replace_once(text,
        "*historyFactor*horizonFactor*changeFactor*",
        "*historyFactor*horizonFactor*changeFactor*crossAssetFactorValue*",
        'cross asset confidence multiplication')

veto="if(controls?.crossAsset?.alignment==='opposed'&&Math.abs(Number(controls.crossAsset.score||0))>=50&&Math.abs(Number(refined?.score||0))<45){direction='WAIT';reason.push('Broad cross-asset transmission materially opposes the pair thesis.');}"
if veto not in text:
    marker="if(controls?.decisionChange?.status==='fresh-flip'&&Math.abs(Number(refined?.score||0))<45){direction='WAIT';reason.push('Fresh directional flip requires stronger evidence before execution.');}"
    text=replace_once(text,marker,marker+'\n  '+veto,'cross asset veto')

# Construct pair cross-asset control after direct market signal.
if 'crossAssetRaw=crossAssetConfirmation(opportunity.symbol,marketData)' not in text:
    text=replace_once(text,
        "const marketSignal=marketAssetSignal(opportunity.symbol,marketData),expectationGap=expectationGapForPair",
        "const marketSignal=marketAssetSignal(opportunity.symbol,marketData),crossAssetRaw=crossAssetConfirmation(opportunity.symbol,marketData),crossAssetDirection=Math.sign(Number(opportunity.score||0))||1,crossAssetAlignment=!crossAssetRaw.available?'unavailable':Math.abs(crossAssetRaw.score)<18?'neutral':Math.sign(crossAssetRaw.score)===crossAssetDirection?'aligned':'opposed',crossAsset={...crossAssetRaw,alignment:crossAssetAlignment,factor:crossAssetAlignment==='aligned'?Number(clamp(1+Math.min(.07,Math.abs(crossAssetRaw.score)/1200),1,1.07).toFixed(3)):crossAssetAlignment==='opposed'?Number(clamp(1-Math.min(.15,Math.abs(crossAssetRaw.score)/650),.85,1).toFixed(3)):1},expectationGap=expectationGapForPair",
        'cross asset pair construction')

# Pass into final controls. Handles reaction gap if present or absent.
if 'decisionChange,crossAsset,' not in text:
    text=replace_once(text,'decisionChange,','decisionChange,crossAsset,','cross asset final controls')

# Expose pair field once.
if 'marketSignal,crossAsset,contradictions' not in text:
    text=replace_once(text,'marketSignal,contradictions','marketSignal,crossAsset,contradictions','cross asset pair output')

# Preserve in governed matrix annotation.
if 'crossAsset:g.crossAsset' not in text:
    text=replace_once(text,'expectationGap:g.expectationGap,','expectationGap:g.expectationGap,crossAsset:g.crossAsset,','cross asset governed annotation')
principle="'cross-asset confirmation uses independent dollar, rates, equity, volatility and gold transmission rather than duplicating pair momentum'"
if principle not in text:
    marker="'highly correlated macro series are clustered so apparent breadth cannot masquerade as independent evidence'"
    text=replace_once(text,marker,marker+','+principle,'cross asset principle')
path.write_text(text,encoding='utf-8')
print('Cross-asset confirmation upgrade applied.')
