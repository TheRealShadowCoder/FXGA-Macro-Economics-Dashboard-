import { collectFreeTierMarketData as collectMeteredAndDerivatives } from './free-market-data.js';
import { collectPublicMicrostructure } from './public-microstructure.js';

export async function collectFreeTierMarketData(){
  const [baseResult,publicResult]=await Promise.allSettled([collectMeteredAndDerivatives(),collectPublicMicrostructure()]);
  const base=baseResult.status==='fulfilled'?baseResult.value:{generatedAt:new Date().toISOString(),architecture:'delegated-free-tier-market-data-router-v1',policy:'metered router unavailable',sources:{},canonicalFx:[],slowFxCrossChecks:[],contextAssets:[],microstructureAssets:[],nasdaqDataLink:{configured:false,activeCollection:false},budget:{providers:{}},counts:{canonicalFx:0,slowFxCrossChecks:0,contextAssets:0,microstructureAssets:0,providersHealthy:0,providersConfigured:0},durationMs:0,error:String(baseResult.reason?.message||baseResult.reason).slice(0,240)};
  const publicData=publicResult.status==='fulfilled'?publicResult.value:{assets:[],sources:{coinbase_exchange:{provider:'coinbase_exchange',ok:false,error:String(publicResult.reason?.message||publicResult.reason).slice(0,220)},kraken_public:{provider:'kraken_public',ok:false,error:String(publicResult.reason?.message||publicResult.reason).slice(0,220)}},policies:{},durationMs:0};
  const sources={...base.sources,...publicData.sources};
  const publicHealthy=Object.values(publicData.sources||{}).filter(source=>source?.ok).length;
  return {
    ...base,
    generatedAt:new Date().toISOString(),
    architecture:'delegated-free-tier-market-data-router-v2',
    policy:'Scarce monthly/daily APIs are budgeted below free ceilings; public exchange feeds carry higher-frequency microstructure where geography permits.',
    sources,
    publicMicrostructurePolicies:publicData.policies,
    microstructureAssets:[...(base.microstructureAssets||[]),...(publicData.assets||[])],
    counts:{
      ...(base.counts||{}),
      microstructureAssets:Number(base.counts?.microstructureAssets||0)+(publicData.assets||[]).length,
      providersHealthy:Number(base.counts?.providersHealthy||0)+publicHealthy,
      publicMicrostructureAssets:(publicData.assets||[]).length,
      publicMicrostructureProvidersHealthy:publicHealthy,
    },
    durationMs:Math.max(Number(base.durationMs||0),Number(publicData.durationMs||0)),
  };
}
