from pathlib import Path


def replace_once(text,old,new,label):
    c=text.count(old)
    if c!=1: raise SystemExit(f'{label}: expected 1 anchor, found {c}')
    return text.replace(old,new,1)

path=Path('cloud-run-collector/src/institutional-research.js')
text=path.read_text(encoding='utf-8')
old="""function buildForecasts(observations=[]){
  const forecasts=[];
  for(const item of observations){
    const values=(item?.history||[]).map(x=>num(x?.value)).filter(Number.isFinite);
    if(values.length<4)continue;
    const ar=ar1Forecast(values),ets=etsForecast(values),kalman=kalmanForecast(values);
    const models=[['AR1',ar],['ETS',ets],['StateSpace',kalman]].filter(([,v])=>Number.isFinite(v));
    if(!models.length)continue;
    const ensemble=mean(models.map(([,v])=>v));
    const residualScale=Math.max(1e-9,stdev(values.slice(-12)));
    const last=values.at(-1),delta=ensemble-last;
    const probabilityUp=sigmoid(delta/residualScale*1.5);
    forecasts.push({
      seriesId:item.seriesId,title:item.title,economy:item.economy||item.economies?.[0]||'GLOBAL',family:macroFamily(item),
      latest:last,forecast:ensemble,delta,models:Object.fromEntries(models),
      interval80:[ensemble-1.2816*residualScale,ensemble+1.2816*residualScale],
      interval95:[ensemble-1.96*residualScale,ensemble+1.96*residualScale],
      probabilities:{up:probabilityUp,down:1-probabilityUp},
      uncertainty:residualScale,sampleSize:values.length,
    });
  }
  return forecasts.slice(0,180);
}
"""
new="""function modelSet(values){return {AR1:ar1Forecast(values),ETS:etsForecast(values),StateSpace:kalmanForecast(values)};}
function walkForwardCalibration(values,maxPoints=12){
  const names=['AR1','ETS','StateSpace'],errors=Object.fromEntries(names.map(n=>[n,[]]));
  const start=Math.max(4,values.length-Math.max(4,maxPoints));
  for(let i=start;i<values.length;i++){
    const train=values.slice(0,i),actual=values[i],predictions=modelSet(train);
    for(const name of names){const prediction=predictions[name];if(Number.isFinite(prediction))errors[name].push(prediction-actual);}
  }
  const rmse=Object.fromEntries(names.map(name=>{const xs=errors[name];return [name,xs.length?Math.sqrt(mean(xs.map(e=>e*e))):null];}));
  const finite=names.filter(name=>Number.isFinite(rmse[name]));
  const scale=Math.max(1e-9,stdev(values.slice(-12))||Math.abs(mean(values.slice(-6))) *.01||1);
  const rawWeights=Object.fromEntries(names.map(name=>[name,finite.includes(name)?1/(scale*scale+rmse[name]*rmse[name]):0]));
  const total=Object.values(rawWeights).reduce((s,x)=>s+x,0)||1;
  const weights=Object.fromEntries(names.map(name=>[name,rawWeights[name]/total]));
  const validationPoints=Math.max(...names.map(name=>errors[name].length),0);
  return {validationPoints,rmse,weights};
}
function buildForecasts(observations=[]){
  const forecasts=[];
  for(const item of observations){
    const values=(item?.history||[]).map(x=>num(x?.value)).filter(Number.isFinite);
    if(values.length<4)continue;
    const current=modelSet(values),models=Object.entries(current).filter(([,v])=>Number.isFinite(v));
    if(!models.length)continue;
    const calibration=walkForwardCalibration(values),available=models.filter(([name])=>Number(calibration.weights[name])>0);
    const weightTotal=available.reduce((s,[name])=>s+Number(calibration.weights[name]||0),0)||1;
    const ensemble=available.length?available.reduce((s,[name,value])=>s+value*Number(calibration.weights[name]||0),0)/weightTotal:mean(models.map(([,v])=>v));
    const residualScale=Math.max(1e-9,stdev(values.slice(-12)));
    const predictionValues=models.map(([,v])=>v),modelDispersion=stdev(predictionValues),agreement=clamp(1-modelDispersion/Math.max(residualScale,1e-9),0,1);
    const validationSufficiency=clamp(calibration.validationPoints/10,0,1),calibrationConfidence=agreement*(.4+.6*validationSufficiency);
    const uncertainty=Math.sqrt(residualScale*residualScale+modelDispersion*modelDispersion);
    const last=values.at(-1),delta=ensemble-last;
    const probabilityUp=sigmoid(delta/Math.max(uncertainty,1e-9)*(1+.75*calibrationConfidence));
    forecasts.push({
      seriesId:item.seriesId,title:item.title,economy:item.economy||item.economies?.[0]||'GLOBAL',family:macroFamily(item),
      latest:last,forecast:ensemble,delta,models:Object.fromEntries(models),
      modelWeights:calibration.weights,walkForwardRmse:calibration.rmse,validationPoints:calibration.validationPoints,
      modelAgreement:Number(agreement.toFixed(4)),calibrationConfidence:Number(calibrationConfidence.toFixed(4)),
      interval80:[ensemble-1.2816*uncertainty,ensemble+1.2816*uncertainty],
      interval95:[ensemble-1.96*uncertainty,ensemble+1.96*uncertainty],
      probabilities:{up:probabilityUp,down:1-probabilityUp},
      uncertainty,innovationScale:residualScale,modelDispersion,sampleSize:values.length,
      methodology:'Walk-forward inverse-error weighting across AR1, exponential smoothing and state-space forecasts; uncertainty combines historical innovation scale and model disagreement.',
    });
  }
  return forecasts.slice(0,180);
}
"""
text=replace_once(text,old,new,'adaptive forecasts')

anchor="function buildFeatures(observations=[]){\n"
source_fn="""function buildSourceReliability(observations=[]){
  const groups=new Map();
  for(const item of observations){const source=String(item?.source||'Unknown');const arr=groups.get(source)||[];arr.push(item);groups.set(source,arr);}
  return [...groups.entries()].map(([source,items])=>{
    const numericCoverage=items.filter(item=>Number.isFinite(num(item?.value))).length/Math.max(1,items.length);
    const freshness=mean(items.map(item=>{const age=ageMinutes(item?.collectedAt||item?.lastUpdated||item?.date);if(age==null)return .25;const halfLife=String(item?.frequency||'').toLowerCase().includes('daily')?7*24*60:String(item?.frequency||'').toLowerCase().includes('weekly')?28*24*60:75*24*60;return Math.max(.05,Math.exp(-Math.log(2)*age/halfLife));}));
    const historyDepth=mean(items.map(item=>Math.min(1,(Array.isArray(item?.history)?item.history.length:0)/12)));
    const anomalyRate=items.filter(item=>{const values=(item?.history||[]).map(x=>num(x?.value)).filter(Number.isFinite),value=num(item?.value);return values.length>=4&&Math.abs(robustZ(value,values))>=5;}).length/Math.max(1,items.length);
    const score=Math.round(100*clamp(.36*numericCoverage+.30*freshness+.24*historyDepth+.10*(1-anomalyRate),0,1));
    return {source,series:items.length,score,status:score>=85?'preferred':score>=65?'accepted':'watch',numericCoverage:Number(numericCoverage.toFixed(4)),freshness:Number(freshness.toFixed(4)),historyDepth:Number(historyDepth.toFixed(4)),anomalyRate:Number(anomalyRate.toFixed(4))};
  }).sort((a,b)=>b.score-a.score);
}

"""
text=replace_once(text,anchor,source_fn+anchor,'source reliability function')
text=replace_once(text,
"  const features=buildFeatures(observations);\n  const forecasts=buildForecasts(observations);\n",
"  const sourceReliability=buildSourceReliability(observations);\n  const features=buildFeatures(observations);\n  const forecasts=buildForecasts(observations);\n",
'source reliability build')
text=replace_once(text,
"    dataQuality,features:features.slice(0,220),forecasts,releaseAnalytics,marketAnalytics,regimes,risk,scenarios,\n",
"    dataQuality,sourceReliability,features:features.slice(0,220),forecasts,releaseAnalytics,marketAnalytics,regimes,risk,scenarios,\n",
'source reliability output')
text=text.replace("'forecast-ensemble','uncertainty-calibration'","'walk-forward-model-calibration','adaptive-forecast-ensemble','model-disagreement-uncertainty','uncertainty-calibration'",1)
path.write_text(text,encoding='utf-8')
print('Adaptive research upgrade applied.')
