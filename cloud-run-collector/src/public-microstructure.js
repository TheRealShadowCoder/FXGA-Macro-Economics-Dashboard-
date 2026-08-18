import { Firestore } from '@google-cloud/firestore';

const db=new Firestore({ignoreUndefinedProperties:true});
const rateState=db.collection('fxga_public_market_rate_budgets');

const POLICIES=Object.freeze({
  coinbase_exchange:{label:'Coinbase Exchange public',documentedPerSecond:10,enforcedPerSecond:4},
  kraken_public:{label:'Kraken public',documentedPerSecond:null,enforcedPerSecond:2},
});

const INSTRUMENTS=Object.freeze([
  {id:'BTCUSD_SPOT',label:'Bitcoin / U.S. Dollar spot',coinbase:'BTC-USD',kraken:'BTC/USD'},
  {id:'ETHUSD_SPOT',label:'Ether / U.S. Dollar spot',coinbase:'ETH-USD',kraken:'ETH/USD'},
]);

const finite=(value)=>{if(typeof value==='number'&&Number.isFinite(value))return value;if(value==null||value==='')return null;const n=Number(String(value).replace(/,/g,'').trim());return Number.isFinite(n)?n:null;};
const secondKey=()=>new Date().toISOString().slice(0,19);

async function reserve(provider,cost=1){
  const policy=POLICIES[provider];if(!policy)return {ok:false,reason:'unknown-provider'};
  const ref=rateState.doc(provider),key=secondKey(),amount=Math.max(1,Number(cost||1));
  return db.runTransaction(async(tx)=>{
    const snap=await tx.get(ref),data=snap.exists?snap.data():{};
    const used=data?.secondKey===key?Number(data.used||0):0;
    if(used+amount>policy.enforcedPerSecond)return {ok:false,reason:'second-budget-exhausted',used,cap:policy.enforcedPerSecond};
    tx.set(ref,{provider,label:policy.label,secondKey:key,used:used+amount,updatedAt:new Date().toISOString(),calls:Number(data?.calls||0)+amount,rateLimited:Number(data?.rateLimited||0),lastStatus:data?.lastStatus??null,lastError:data?.lastError??null},{merge:false});
    return {ok:true};
  });
}
async function record(provider,{status=null,error=null}={}){
  const ref=rateState.doc(provider);await db.runTransaction(async(tx)=>{const snap=await tx.get(ref),data=snap.exists?snap.data():{};tx.set(ref,{...data,updatedAt:new Date().toISOString(),lastStatus:status,lastError:error?String(error).slice(0,220):null,rateLimited:Number(data?.rateLimited||0)+(Number(status)===429?1:0)},{merge:false});});
}
async function json(provider,url,{timeoutMs=6000,maxBytes=800000}={}){
  const admission=await reserve(provider);if(!admission.ok)return {ok:false,skipped:true,reason:admission.reason};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'FXGA-Public-Microstructure/1.0'},signal:controller.signal,redirect:'follow'});
    const body=Buffer.from(await response.arrayBuffer());
    if(body.length>maxBytes){await record(provider,{status:response.status,error:'response-too-large'});return {ok:false,status:response.status,error:'response-too-large'};}
    const text=body.toString('utf8');
    if(!response.ok){await record(provider,{status:response.status,error:text});return {ok:false,status:response.status,error:text.slice(0,220)};}
    const data=JSON.parse(text);await record(provider,{status:response.status});return {ok:true,data,status:response.status,bytes:body.length};
  }catch(error){const message=String(error?.message||error);await record(provider,{error:message}).catch(()=>{});return {ok:false,error:message.slice(0,220)};}finally{clearTimeout(timer);}
}
function metrics(levels=[]){
  const rows=(Array.isArray(levels)?levels:[]).slice(0,20).map((row)=>Array.isArray(row)?{price:finite(row[0]),size:finite(row[1]),orders:finite(row[2])}:{price:finite(row?.price),size:finite(row?.qty??row?.size),orders:finite(row?.count)}).filter(row=>row.price!=null&&row.size!=null);
  return {levels:rows.length,size:rows.reduce((s,row)=>s+row.size,0),notional:rows.reduce((s,row)=>s+row.size*row.price,0),top:rows[0]||null};
}
function asset({id,label,symbol,source,price,bid,ask,bidSize,askSize,volume=null,providerTimestamp=null,metadata={}}){
  return {id,label,symbol,assetClass:'crypto-spot',price:finite(price),bid:finite(bid),ask:finite(ask),bidSize:finite(bidSize),askSize:finite(askSize),volume:finite(volume),source,sourceUrl:null,fetchedAt:new Date().toISOString(),providerTimestamp,mode:'public-l2-rest',stale:false,metadata};
}
async function collectCoinbase(){
  const assets=[],diagnostics=[];
  for(const instrument of INSTRUMENTS){
    const bookUrl=new URL(`https://api.exchange.coinbase.com/products/${instrument.coinbase}/book`);bookUrl.searchParams.set('level','2');
    const [book,ticker]=await Promise.all([
      json('coinbase_exchange',bookUrl,{maxBytes:750000}),
      json('coinbase_exchange',`https://api.exchange.coinbase.com/products/${instrument.coinbase}/ticker`,{maxBytes:150000}),
    ]);
    diagnostics.push({symbol:instrument.coinbase,book:book.ok,ticker:ticker.ok,bookStatus:book.status??null,tickerStatus:ticker.status??null});
    if(!book.ok&&!ticker.ok)continue;
    const bids=metrics(book.data?.bids),asks=metrics(book.data?.asks),tick=ticker.data||{};
    const bid=finite(tick.bid)??bids.top?.price??null,ask=finite(tick.ask)??asks.top?.price??null,last=finite(tick.price)??(bid!=null&&ask!=null?(bid+ask)/2:null);
    if(last==null)continue;
    const imbalance=bids.size+asks.size>0?(bids.size-asks.size)/(bids.size+asks.size):null;
    assets.push(asset({id:`${instrument.id}_COINBASE`,label:`${instrument.label} · Coinbase`,symbol:instrument.coinbase,source:'Coinbase Exchange public',price:last,bid,ask,bidSize:bids.top?.size,askSize:asks.top?.size,volume:tick.volume,providerTimestamp:book.data?.time||tick.time||null,metadata:{quotaClass:'high-capacity-public',book:{bid:bids,ask:asks,imbalance},sequence:book.data?.sequence??null}}));
  }
  return {assets,source:{provider:'coinbase_exchange',ok:assets.length>0,usable:assets.length,diagnostics}};
}
function krakenResult(payload){
  if(!payload||typeof payload!=='object'||(Array.isArray(payload.error)&&payload.error.length))return null;
  const result=payload.result;if(!result||typeof result!=='object')return null;
  if(Array.isArray(result))return result[0]||null;
  if(result.symbol||result.bids||result.asks)return result;
  return Object.values(result).find(value=>value&&typeof value==='object')||null;
}
async function collectKraken(){
  const assets=[],diagnostics=[];
  for(const instrument of INSTRUMENTS){
    const url=new URL('https://api.kraken.com/0/public/PreTrade');url.searchParams.set('symbol',instrument.kraken);
    const result=await json('kraken_public',url,{maxBytes:500000});diagnostics.push({symbol:instrument.kraken,ok:result.ok,status:result.status??null});
    if(!result.ok)continue;
    const row=krakenResult(result.data);if(!row)continue;
    const bids=metrics(row.bids),asks=metrics(row.asks),bid=bids.top?.price??null,ask=asks.top?.price??null,mid=bid!=null&&ask!=null?(bid+ask)/2:null;
    if(mid==null)continue;
    const imbalance=bids.size+asks.size>0?(bids.size-asks.size)/(bids.size+asks.size):null;
    assets.push(asset({id:`${instrument.id}_KRAKEN`,label:`${instrument.label} · Kraken`,symbol:instrument.kraken,source:'Kraken public',price:mid,bid,ask,bidSize:bids.top?.size,askSize:asks.top?.size,providerTimestamp:bids.top?.publication_ts||asks.top?.publication_ts||null,metadata:{quotaClass:'high-capacity-public',book:{bid:bids,ask:asks,imbalance},venue:row.venue||null,system:row.system||null}}));
  }
  return {assets,source:{provider:'kraken_public',ok:assets.length>0,usable:assets.length,diagnostics}};
}
export async function collectPublicMicrostructure(){
  const started=Date.now();const [coinbase,kraken]=await Promise.allSettled([collectCoinbase(),collectKraken()]);
  const cb=coinbase.status==='fulfilled'?coinbase.value:{assets:[],source:{provider:'coinbase_exchange',ok:false,error:String(coinbase.reason?.message||coinbase.reason).slice(0,220)}};
  const kr=kraken.status==='fulfilled'?kraken.value:{assets:[],source:{provider:'kraken_public',ok:false,error:String(kraken.reason?.message||kraken.reason).slice(0,220)}};
  return {generatedAt:new Date().toISOString(),assets:[...cb.assets,...kr.assets],sources:{coinbase_exchange:cb.source,kraken_public:kr.source},policies:POLICIES,durationMs:Date.now()-started};
}
