import assert from 'node:assert/strict';
import { backtestEventPatterns } from '../src/event-pattern-backtester.js';

const start=Date.UTC(2024,0,1,13,30);
const studies=[];
for(let i=0;i<80;i++){
  const releaseAt=new Date(start+i*7*86_400_000).toISOString();
  const direction=i%5===0?'down':'up';
  const pattern=i%3===0?'compression':'bullish-trend';
  const move=(i<56?0.12:0.10)+(i%7)*0.004;
  studies.push({
    eventId:`synthetic-cpi-${i}`,
    event:'Consumer Price Index',
    interpretationFamily:'inflation',
    category:'inflation',
    currency:'USD',
    importance:3,
    releaseAt,
    timeSignature:{sessionUtc:i%2?'NEW_YORK':'LONDON_NEW_YORK_OVERLAP',weekday:'Wednesday'},
    preNews:{
      crossAsset:{state:i%4?'mixed-breadth':'broad-risk-up',volatilityState:i%3?'pre-news-compression':'mixed-volatility'},
      assets:[{
        assetId:'EURUSD',
        dominantDirection:direction,
        windows:{
          '1h':{available:true,patterns:[pattern]},
          '30m':{available:true,patterns:[pattern]},
          '15m':{available:true,patterns:[pattern]},
        },
      }],
    },
    horizons:{
      '1h':{reactions:[{assetId:'EURUSD',available:true,rawMovePct:move}]},
      '4h':{reactions:[{assetId:'EURUSD',available:true,rawMovePct:move*1.4}]},
      '24h':{reactions:[{assetId:'EURUSD',available:true,rawMovePct:move*1.7}]},
    },
  });
}

const result=backtestEventPatterns(studies,{minTrain:12,minHoldout:5,holdoutFraction:.30});
assert.equal(result.schema,'fxga.event-pattern-backtest.v3');
assert(result.totalObservations>=240,'expected synthetic horizon observations');
assert(result.hierarchicalHypotheses>result.totalObservations/10,'hierarchical hypothesis generation missing');
assert(result.tests>0,'hierarchical pooling should produce testable OOS groups');
assert(result.testsByTier?.T0?.tests>0,'broad T0 pool must be testable');
assert(result.testsByTier?.T1?.tests>0,'T1 pool must be testable');
assert(Array.isArray(result.topTests)&&result.topTests.length>0,'top tests missing');
for(const test of result.topTests){
  assert(Number.isFinite(Number(test.qValue)),'q-value must be finite');
  assert(test.hierarchy&&typeof test.hierarchy==='object','hierarchy evidence missing');
  assert(test.promotionChecks&&typeof test.promotionChecks.parentSupport==='boolean','parent support gate missing');
  assert(['validated-candidate','not-promoted'].includes(test.validationStatus),'invalid validation status');
}
console.log(JSON.stringify({ok:true,schema:result.schema,totalObservations:result.totalObservations,hypotheses:result.hierarchicalHypotheses,tests:result.tests,validatedCandidates:result.validatedCandidates,testsByTier:result.testsByTier},null,2));
