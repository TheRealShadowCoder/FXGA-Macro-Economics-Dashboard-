import assert from 'node:assert/strict';
import { TARGET_ECONOMIES } from '../src/super-economist-core.js';
import { buildSuperEconomist } from '../src/super-economist.js';

const now=new Date();
const date=now.toISOString().slice(0,10);
const history=(base,step)=>Array.from({length:8},(_,i)=>({date:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-7+i,1)).toISOString().slice(0,10),value:base+step*i}));

const DIMENSIONS=[
  ['inflation','Consumer Price Inflation',100,0.4],
  ['growth','Real GDP Growth',50,0.3],
  ['labour','Employment Growth',75,0.2],
  ['policy','Central Bank Policy Rate',5,0.05],
  ['financial','Financial Conditions Credit',20,0.1],
];

function observation(economy,dimension,index){
  const [category,title,base,step]=DIMENSIONS[index];
  const h=history(base+index,step);
  return {
    seriesId:`TEST_${economy}_${dimension}`,
    title:`${economy} ${title}`,
    value:h.at(-1).value,
    previous:h.at(-2).value,
    change:h.at(-1).value-h.at(-2).value,
    date,
    units:'test units',
    frequency:'Monthly',
    categories:[category],
    economy,
    economies:[economy],
    importance:'high',
    source:'Institutional regression fixture',
    history:h,
  };
}

function assertEngine(engine,label){
  assert(engine&&typeof engine==='object',`${label}: engine missing`);
  const economies=engine?.economyAnalysis?.economies;
  assert(Array.isArray(economies),`${label}: economyAnalysis.economies missing`);
  assert.equal(economies.length,TARGET_ECONOMIES.length,`${label}: economy count drift`);
  for(const id of TARGET_ECONOMIES){
    const state=economies.find(row=>row.id===id);
    assert(state,`${label}: missing economy ${id}`);
    assert(Number.isFinite(Number(state.currencyScore)),`${label}: ${id} currencyScore not finite`);
    assert(Number.isFinite(Number(state.confidence)),`${label}: ${id} confidence not finite`);
    assert(Array.isArray(state.dimensions)&&state.dimensions.length===5,`${label}: ${id} dimensions incomplete`);
    for(const dimension of state.dimensions){
      assert(typeof dimension.id==='string',`${label}: ${id} dimension id missing`);
      assert(Number.isFinite(Number(dimension.score)),`${label}: ${id}/${dimension.id} score not finite`);
      assert(Array.isArray(dimension.contributors),`${label}: ${id}/${dimension.id} contributors missing`);
    }
  }
  assert(engine.macroAnalysis&&Array.isArray(engine.macroAnalysis.dimensions),`${label}: macro analysis missing`);
  assert(engine.releaseImpact&&Array.isArray(engine.releaseImpact.assets),`${label}: release impact missing`);
  assert(engine.registry?.totalMethods>0,`${label}: method registry missing`);
}

const completeObservations=TARGET_ECONOMIES.flatMap(economy=>DIMENSIONS.map(([dimension],index)=>observation(economy,dimension,index)));
const complete=buildSuperEconomist({observations:completeObservations,events:[],news:[],familyReliability:{},marketData:[],decisionMemory:null,eventStudies:null,policyCalibration:null});
assertEngine(complete,'complete-global-fixture');

// Regression for the production failure class: newly added economies may have sparse or
// zero usable series while the original economies remain populated. The intelligence layer
// must degrade confidence, never dereference a missing score and crash the full macro sync.
const sparseObservations=completeObservations.filter(row=>['USA','EUROPE','UK','SOUTH_AFRICA','JAPAN','CANADA'].includes(row.economy));
const sparse=buildSuperEconomist({observations:sparseObservations,events:[],news:[],familyReliability:{},marketData:[],decisionMemory:null,eventStudies:null,policyCalibration:null});
assertEngine(sparse,'sparse-global-fixture');
for(const state of sparse.economyAnalysis.economies.filter(row=>!['USA','EUROPE','UK','SOUTH_AFRICA','JAPAN','CANADA'].includes(row.id))){
  assert.equal(state.observationCount,0,`sparse-global-fixture: ${state.id} should remain explicitly uncovered`);
  assert.equal(state.confidence,0,`sparse-global-fixture: ${state.id} uncovered confidence must be zero`);
}

console.log(JSON.stringify({
  ok:true,
  schema:'fxga.institutional.macro-regression.v1',
  targetEconomies:TARGET_ECONOMIES.length,
  completeObservations:completeObservations.length,
  sparseObservations:sparseObservations.length,
  checks:['finite-dimensions','finite-confidence','sparse-economy-safety','registry-present','release-impact-present'],
},null,2));
