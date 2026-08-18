from pathlib import Path


def replace_once(text, old, new, label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return text.replace(old,new,1)

path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')

if 'function reactionFunctionForEconomy(' not in text:
    anchor='function causalTransmissionForPair(opportunity,economies,marketSignal){\n'
    fn="""function reactionFunctionForEconomy(state){
  if(!state)return {available:false,dataPressure:0,policyEvidence:0,gap:0,status:'unavailable',components:{}};
  const inflation=dimensionScore(state,'inflation'),labour=dimensionScore(state,'labour'),growth=dimensionScore(state,'growth'),policy=dimensionScore(state,'policy'),financial=dimensionScore(state,'financial');
  const dataPressure=.48*inflation+.25*labour+.17*growth+.10*financial,gap=dataPressure-policy,status=gap>=18?'hawkish-repricing-risk':gap<=-18?'dovish-repricing-risk':'policy-near-data';
  return {available:true,economy:state.id,currency:state.currency,centralBank:state.centralBank,dataPressure:Math.round(dataPressure),policyEvidence:Math.round(policy),gap:Math.round(gap),status,components:{inflation:Math.round(inflation),labour:Math.round(labour),growth:Math.round(growth),financial:Math.round(financial),policy:Math.round(policy)}};
}
function reactionFunctionGapForPair(opportunity,economies){
  const [base,quote]=currenciesForSymbol(opportunity.symbol),baseState=base==='XAU'?null:economyStateForCurrency(economies,base),quoteState=economyStateForCurrency(economies,quote),baseGap=base==='XAU'?{available:false,currency:'XAU',gap:0,status:'not-applicable'}:reactionFunctionForEconomy(baseState),quoteGap=reactionFunctionForEconomy(quoteState),differential=base==='XAU'?-Number(quoteGap.gap||0):Number(baseGap.gap||0)-Number(quoteGap.gap||0),direction=Math.sign(Number(opportunity?.score||0))||1,alignment=Math.abs(differential)<12?'neutral':Math.sign(differential)===direction?'aligned':'opposed',factor=alignment==='aligned'?clamp(1+Math.min(.06,Math.abs(differential)/1200),1,1.06):alignment==='opposed'?clamp(1-Math.min(.13,Math.abs(differential)/700),.87,1):1;
  return {symbol:opportunity.symbol,base:baseGap,quote:quoteGap,differential:Math.round(differential),alignment,factor:Number(factor.toFixed(3)),status:Math.abs(differential)>=35?(alignment==='aligned'?'strong-repricing-support':'strong-repricing-conflict'):Math.abs(differential)>=15?(alignment==='aligned'?'repricing-support':'repricing-conflict'):'balanced'};
}
"""
    text=replace_once(text,anchor,fn+anchor,'reaction function insertion')

if 'reactionFactor=Number(controls?.reactionFunctionGap?.factor||1)' not in text:
    text=replace_once(text,
        "changeFactor=Number(controls?.decisionChange?.factor||1),counterfactualFactor=Number(controls?.counterfactual?.factor||1)",
        "changeFactor=Number(controls?.decisionChange?.factor||1),reactionFactor=Number(controls?.reactionFunctionGap?.factor||1),counterfactualFactor=Number(controls?.counterfactual?.factor||1)",
        'reaction factor declaration')
    text=replace_once(text,
        "*historyFactor*horizonFactor*changeFactor*counterfactualFactor*temporalFactor*",
        "*historyFactor*horizonFactor*changeFactor*reactionFactor*counterfactualFactor*temporalFactor*",
        'reaction factor confidence multiplication')

veto="if(controls?.reactionFunctionGap?.status==='strong-repricing-conflict'&&Math.abs(Number(refined?.score||0))<50){direction='WAIT';reason.push('Central-bank reaction-function repricing risk materially opposes the directional thesis.');}"
if veto not in text:
    fresh="if(controls?.decisionChange?.status==='fresh-flip'&&Math.abs(Number(refined?.score||0))<45){direction='WAIT';reason.push('Fresh directional flip requires stronger evidence before execution.');}"
    text=replace_once(text,fresh,fresh+'\n  '+veto,'reaction function veto')

if 'reactionFunctionGap=reactionFunctionGapForPair(opportunity,economies)' not in text:
    text=replace_once(text,
        ",causalTransmission=causalTransmissionForPair(opportunity,economies,marketSignal)",
        ",reactionFunctionGap=reactionFunctionGapForPair(opportunity,economies),causalTransmission=causalTransmissionForPair(opportunity,economies,marketSignal)",
        'reaction function pair construction')

if 'decisionChange,reactionFunctionGap,counterfactual' not in text:
    text=replace_once(text,'decisionChange,counterfactual,temporal','decisionChange,reactionFunctionGap,counterfactual,temporal','reaction function final controls')

if 'refined,reactionFunctionGap,causalTransmission' not in text:
    text=replace_once(text,'refined,causalTransmission,counterfactual','refined,reactionFunctionGap,causalTransmission,counterfactual','reaction function pair output')

if 'reactionFunctionGap:g.reactionFunctionGap' not in text:
    text=replace_once(text,'expectationGap:g.expectationGap,contradictions:g.contradictions','expectationGap:g.expectationGap,reactionFunctionGap:g.reactionFunctionGap,contradictions:g.contradictions','reaction function governed annotation')

principle="'central-bank reaction-function gaps identify future policy repricing risk relative to growth, inflation and labour pressure'"
if principle not in text:
    marker="'fresh directional flips are treated as whipsaw risk until evidence is strong enough'"
    text=replace_once(text,marker,marker+','+principle,'reaction function principle')

path.write_text(text,encoding='utf-8')
print('Robust central-bank reaction-function gap integration applied.')
