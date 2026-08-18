from pathlib import Path


def replace_once(text,old,new,label):
    c=text.count(old)
    if c!=1: raise SystemExit(f'{label}: expected 1 anchor, found {c}')
    return text.replace(old,new,1)

path=Path('cloud-run-collector/src/institutional-research.js')
text=path.read_text(encoding='utf-8')

# Walk-forward residual distribution from the adaptive ensemble.
text=replace_once(text,
"  const validationPoints=Math.max(...names.map(name=>errors[name].length),0);\n  return {validationPoints,rmse,bias,recentRmse,earlierRmse,driftRatio,weights};\n",
"  const validationPoints=Math.max(...names.map(name=>errors[name].length),0),alignedPoints=Math.min(...names.map(name=>errors[name].length));\n  const ensembleResiduals=[];for(let i=0;i<alignedPoints;i++)ensembleResiduals.push(names.reduce((s,name)=>s+Number(weights[name]||0)*Number(errors[name][i]||0),0));\n  const sorted=[...ensembleResiduals].sort((a,b)=>a-b),quantile=q=>{if(!sorted.length)return null;const pos=(sorted.length-1)*q,lo=Math.floor(pos),hi=Math.ceil(pos);return lo===hi?sorted[lo]:sorted[lo]+(sorted[hi]-sorted[lo])*(pos-lo);},residualMean=mean(ensembleResiduals),residualSd=stdev(ensembleResiduals),third=ensembleResiduals.length?mean(ensembleResiduals.map(e=>(e-residualMean)**3)):0,residualSkew=residualSd>1e-12?third/(residualSd**3):0;\n  const residualQuantiles={q025:quantile(.025),q05:quantile(.05),q10:quantile(.10),q25:quantile(.25),q50:quantile(.50),q75:quantile(.75),q90:quantile(.90),q95:quantile(.95),q975:quantile(.975)};\n  return {validationPoints,rmse,bias,recentRmse,earlierRmse,driftRatio,weights,ensembleResiduals,residualQuantiles,residualMean,residualSd,residualSkew};\n",
'empirical residual distribution')

text=replace_once(text,
"    const uncertainty=Math.sqrt(residualScale*residualScale+modelDispersion*modelDispersion+(weightedBias*weightedBias));\n    const last=values.at(-1),delta=ensemble-last;\n    const probabilityUp=sigmoid(delta/Math.max(uncertainty,1e-9)*(1+.75*effectiveCalibrationConfidence));\n",
"    const empiricalResidualSd=Number(calibration.residualSd||0),uncertainty=Math.sqrt(Math.max(residualScale,empiricalResidualSd)**2+modelDispersion*modelDispersion+(weightedBias*weightedBias));\n    const last=values.at(-1),delta=ensemble-last,normalProbability=sigmoid(delta/Math.max(uncertainty,1e-9)*(1+.75*effectiveCalibrationConfidence)),residuals=calibration.ensembleResiduals||[],empiricalProbability=residuals.length?residuals.filter(error=>error<delta).length/residuals.length:normalProbability,empiricalBlend=clamp((residuals.length-4)/12,0,.75),probabilityUp=clamp((1-empiricalBlend)*normalProbability+empiricalBlend*empiricalProbability,.01,.99);\n    const q=calibration.residualQuantiles||{},useEmpirical=residuals.length>=8&&Number.isFinite(q.q10)&&Number.isFinite(q.q90),interval80=useEmpirical?[ensemble-q.q90,ensemble-q.q10]:[ensemble-1.2816*uncertainty,ensemble+1.2816*uncertainty],interval95=useEmpirical&&Number.isFinite(q.q025)&&Number.isFinite(q.q975)?[ensemble-q.q975,ensemble-q.q025]:[ensemble-1.96*uncertainty,ensemble+1.96*uncertainty],upperTail=Number.isFinite(q.q95)&&Number.isFinite(q.q50)?q.q95-q.q50:null,lowerTail=Number.isFinite(q.q50)&&Number.isFinite(q.q05)?q.q50-q.q05:null,tailAsymmetry=Number.isFinite(upperTail)&&Number.isFinite(lowerTail)&&Math.abs(lowerTail)>1e-12?upperTail/lowerTail:null;\n",
'distribution probability and intervals')
text=replace_once(text,
"      modelAgreement:Number(agreement.toFixed(4)),calibrationConfidence:Number(effectiveCalibrationConfidence.toFixed(4)),rawCalibrationConfidence:Number(calibrationConfidence.toFixed(4)),driftScore,driftStatus,forecastBias:weightedBias,\n      interval80:[ensemble-1.2816*uncertainty,ensemble+1.2816*uncertainty],\n      interval95:[ensemble-1.96*uncertainty,ensemble+1.96*uncertainty],\n      probabilities:{up:probabilityUp,down:1-probabilityUp},\n      uncertainty,innovationScale:residualScale,modelDispersion,sampleSize:values.length,\n      methodology:'Walk-forward inverse-error weighting across AR1, exponential smoothing and state-space forecasts; uncertainty combines historical innovation scale and model disagreement.',\n",
"      modelAgreement:Number(agreement.toFixed(4)),calibrationConfidence:Number(effectiveCalibrationConfidence.toFixed(4)),rawCalibrationConfidence:Number(calibrationConfidence.toFixed(4)),driftScore,driftStatus,forecastBias:weightedBias,\n      interval80,interval95,\n      probabilities:{up:probabilityUp,down:1-probabilityUp,normalReference:normalProbability,empiricalReference:empiricalProbability},\n      distribution:{method:useEmpirical?'walk-forward-empirical-residuals':'hybrid-parametric',residualCount:residuals.length,residualMean:Number(calibration.residualMean||0),residualSd:empiricalResidualSd,residualSkew:Number(calibration.residualSkew||0),tailAsymmetry,residualQuantiles:q,empiricalBlend:Number(empiricalBlend.toFixed(3))},\n      uncertainty,innovationScale:residualScale,modelDispersion,sampleSize:values.length,\n      methodology:'Walk-forward inverse-error model weighting with drift control. Probability and uncertainty bands use the empirical ensemble residual distribution when sample depth is sufficient; otherwise a conservative hybrid fallback is used.',\n",
'distribution forecast output')
text=text.replace("'model-disagreement-uncertainty','forecast-error-attribution'","'model-disagreement-uncertainty','empirical-residual-distribution','quantile-forecast-bands','tail-asymmetry','forecast-error-attribution'",1)
path.write_text(text,encoding='utf-8')
print('Distributional forecast upgrade applied.')
