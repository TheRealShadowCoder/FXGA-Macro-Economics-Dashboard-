from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return text.replace(old, new, 1)

# ---------- Google Cloud Run: versioned Firestore chunk storage ----------
path = Path('cloud-run-collector/src/super-runtime.js')
text = path.read_text(encoding='utf-8')

if "const stateChunks=db.collection('fxga_collector_state_chunks');" not in text:
    text = replace_once(
        text,
        "const state=db.collection('fxga_collector_state');\nconst audit=db.collection('fxga_super_economist_audit');\n",
        "const state=db.collection('fxga_collector_state');\nconst stateChunks=db.collection('fxga_collector_state_chunks');\nconst audit=db.collection('fxga_super_economist_audit');\nconst FIRESTORE_INLINE_MAX_BYTES=700_000;\nconst FIRESTORE_CHUNK_RAW_BYTES=540*1024;\n",
        'firestore chunk constants'
    )

old_storage = """async function get(name){const x=await state.doc(name).get();return x.exists?x.data():null;}
async function putChanged(name,payload){const ref=state.doc(name),old=await ref.get(),h=hash(payload);if(old.exists&&old.data()?.hash===h)return false;await ref.set({hash:h,updatedAt:new Date().toISOString(),payload},{merge:false});return true;}
"""
new_storage = """function chunkDocId(name,generation,index){return `${name}__${generation}__${String(index).padStart(4,'0')}`;}
async function removeChunkGeneration(name,generation,count){
  if(!generation||!Number.isFinite(Number(count))||Number(count)<=0)return;
  const jobs=[];for(let i=0;i<Number(count);i++)jobs.push(stateChunks.doc(chunkDocId(name,generation,i)).delete().catch(()=>null));await Promise.all(jobs);
}
async function get(name){
  const x=await state.doc(name).get();if(!x.exists)return null;const data=x.data();if(!data?.chunked)return data;
  const generation=String(data.generation||''),count=Number(data.chunkCount||0);if(!generation||!Number.isInteger(count)||count<1)throw new Error(`Chunk manifest for ${name} is invalid`);
  const chunks=[];for(let i=0;i<count;i+=8){const indexes=Array.from({length:Math.min(8,count-i)},(_,offset)=>i+offset),snaps=await Promise.all(indexes.map(index=>stateChunks.doc(chunkDocId(name,generation,index)).get()));for(let j=0;j<snaps.length;j++){const snap=snaps[j],index=indexes[j];if(!snap.exists)throw new Error(`Chunk ${index+1}/${count} missing for ${name}`);const encoded=snap.data()?.data;if(typeof encoded!=='string')throw new Error(`Chunk ${index+1}/${count} is invalid for ${name}`);chunks[index]=Buffer.from(encoded,'base64');}}
  const json=Buffer.concat(chunks).toString('utf8');if(Number(data.byteLength||0)&&Buffer.byteLength(json,'utf8')!==Number(data.byteLength))throw new Error(`Chunk byte length mismatch for ${name}`);if(data.hash&&hash(json)!==data.hash)throw new Error(`Chunk hash mismatch for ${name}`);return {...data,payload:JSON.parse(json)};
}
async function putChanged(name,payload){
  const ref=state.doc(name),old=await ref.get(),oldData=old.exists?old.data():null,serialized=JSON.stringify(payload),h=hash(serialized);if(oldData?.hash===h)return false;const updatedAt=new Date().toISOString(),bytes=Buffer.from(serialized,'utf8');
  if(bytes.length<=FIRESTORE_INLINE_MAX_BYTES){await ref.set({hash:h,updatedAt,payload},{merge:false});if(oldData?.chunked)removeChunkGeneration(name,oldData.generation,oldData.chunkCount).catch(()=>{});return true;}
  const generation=h.slice(0,24),chunks=[];for(let offset=0;offset<bytes.length;offset+=FIRESTORE_CHUNK_RAW_BYTES)chunks.push(bytes.subarray(offset,Math.min(bytes.length,offset+FIRESTORE_CHUNK_RAW_BYTES)));
  for(let i=0;i<chunks.length;i+=6){const indexes=Array.from({length:Math.min(6,chunks.length-i)},(_,offset)=>i+offset);await Promise.all(indexes.map(index=>stateChunks.doc(chunkDocId(name,generation,index)).set({name,generation,index,count:chunks.length,encoding:'base64',data:chunks[index].toString('base64')},{merge:false})));}
  await ref.set({hash:h,updatedAt,chunked:true,encoding:'base64-json',generation,chunkCount:chunks.length,byteLength:bytes.length},{merge:false});
  if(oldData?.chunked&&oldData.generation!==generation)removeChunkGeneration(name,oldData.generation,oldData.chunkCount).catch(()=>{});
  console.log('Chunked collector state',JSON.stringify({name,byteLength:bytes.length,chunkCount:chunks.length,generation}));return true;
}
"""
if 'async function get(name){' in text and 'Chunk manifest for ${name}' not in text:
    text = replace_once(text, old_storage, new_storage, 'firestore get/put chunk storage')

# Preserve the full canonical payload, but remove pure duplicate nested decision objects.
path.write_text(text, encoding='utf-8')

path = Path('cloud-run-collector/src/super-economist.js')
text = path.read_text(encoding='utf-8')
old_research = "  const research={...researchBase,decisionCore,decisionMemory};\n"
new_research = "  const research=researchBase;\n"
if old_research in text:
    text = replace_once(text, old_research, new_research, 'deduplicate nested research decision objects')
path.write_text(text, encoding='utf-8')

# ---------- Cloudflare Durable Object: chunk only oversized intelligence state ----------
path = Path('worker/index-v3.ts')
text = path.read_text(encoding='utf-8')

if "const INTELLIGENCE_CHUNK_CHARS=60_000;" not in text:
    text = replace_once(
        text,
        "const REPLAY_KEY='google:recent-request-ids';\n",
        "const REPLAY_KEY='google:recent-request-ids';\nconst INTELLIGENCE_CHUNK_CHARS=60_000;\n",
        'durable object chunk constant'
    )

class_anchor = """export class FxgaCoordinator extends DurableObject<Env>{
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);}
  private broadcast(payload:unknown){const message=JSON.stringify(payload);for(const socket of this.ctx.getWebSockets())if(socket.readyState===WebSocket.OPEN){try{socket.send(message);}catch{}}}
"""
class_helpers = """export class FxgaCoordinator extends DurableObject<Env>{
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);}
  private intelligenceChunkKey(generation:string,index:number){return `${INTELLIGENCE_KEY}:chunk:${generation}:${String(index).padStart(4,'0')}`;}
  private async deleteIntelligenceChunks(manifest:any){if(!manifest?.chunked||!manifest?.generation||!Number.isInteger(Number(manifest?.chunkCount)))return;const count=Number(manifest.chunkCount);for(let i=0;i<count;i+=12){const indexes=Array.from({length:Math.min(12,count-i)},(_,offset)=>i+offset);await Promise.all(indexes.map(index=>this.ctx.storage.delete(this.intelligenceChunkKey(String(manifest.generation),index)).catch(()=>false)));}}
  private async readIntelligence(){const stored=await this.ctx.storage.get<any>(INTELLIGENCE_KEY);if(!stored?.chunked)return stored??null;const generation=String(stored.generation||''),count=Number(stored.chunkCount||0);if(!generation||!Number.isInteger(count)||count<1)throw new Error('Intelligence chunk manifest is invalid');const chunks:string[]=[];for(let i=0;i<count;i+=12){const indexes=Array.from({length:Math.min(12,count-i)},(_,offset)=>i+offset),values=await Promise.all(indexes.map(index=>this.ctx.storage.get<string>(this.intelligenceChunkKey(generation,index))));for(let j=0;j<values.length;j++){const value=values[j],index=indexes[j];if(typeof value!=='string')throw new Error(`Intelligence chunk ${index+1}/${count} is missing`);chunks[index]=value;}}const serialized=chunks.join('');if(Number(stored.charLength||0)&&serialized.length!==Number(stored.charLength))throw new Error('Intelligence chunk length mismatch');return JSON.parse(serialized);}
  private async writeIntelligence(payload:Record<string,any>,requestId:string){const serialized=JSON.stringify(payload),previous=await this.ctx.storage.get<any>(INTELLIGENCE_KEY);if(serialized.length<=INTELLIGENCE_CHUNK_CHARS){await this.ctx.storage.put(INTELLIGENCE_KEY,payload);if(previous?.chunked)await this.deleteIntelligenceChunks(previous);return {chunked:false,charLength:serialized.length,chunkCount:1};}const generation=(requestId||crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,48)||String(Date.now()),chunks=[] as string[];for(let offset=0;offset<serialized.length;offset+=INTELLIGENCE_CHUNK_CHARS)chunks.push(serialized.slice(offset,offset+INTELLIGENCE_CHUNK_CHARS));for(let i=0;i<chunks.length;i+=10){const indexes=Array.from({length:Math.min(10,chunks.length-i)},(_,offset)=>i+offset);await Promise.all(indexes.map(index=>this.ctx.storage.put(this.intelligenceChunkKey(generation,index),chunks[index])));}await this.ctx.storage.put(INTELLIGENCE_KEY,{chunked:true,version:1,generation,chunkCount:chunks.length,charLength:serialized.length,generatedAt:payload.generatedAt??new Date().toISOString()});if(previous?.chunked&&previous.generation!==generation)await this.deleteIntelligenceChunks(previous);return {chunked:true,charLength:serialized.length,chunkCount:chunks.length};}
  private broadcast(payload:unknown){const message=JSON.stringify(payload);for(const socket of this.ctx.getWebSockets())if(socket.readyState===WebSocket.OPEN){try{socket.send(message);}catch{}}}
"""
if 'private async writeIntelligence(' not in text:
    text = replace_once(text, class_anchor, class_helpers, 'durable object intelligence chunk helpers')

old_intelligence_write = "else if(type==='intelligence-snapshot'){if(Number(payload?.registry?.totalMethods)!==9705||Number(payload?.registry?.totalFamilies)!==150)throw new Error('intelligence-snapshot registry contract failed');await this.ctx.storage.put(INTELLIGENCE_KEY,payload);}"
new_intelligence_write = "else if(type==='intelligence-snapshot'){if(Number(payload?.registry?.totalMethods)!==9705||Number(payload?.registry?.totalFamilies)!==150)throw new Error('intelligence-snapshot registry contract failed');const stored=await this.writeIntelligence(payload,requestId);console.log('Stored intelligence snapshot',JSON.stringify(stored));}"
if old_intelligence_write in text:
    text = replace_once(text, old_intelligence_write, new_intelligence_write, 'durable object chunked intelligence write')

old_state_read = "private async state(){const [calendar,macro,intelligence,market,technical,eventStudies,meta]=await Promise.all([this.ctx.storage.get<Record<string,any>>(CALENDAR_KEY),this.ctx.storage.get<Record<string,any>>(MACRO_KEY),this.ctx.storage.get<Record<string,any>>(INTELLIGENCE_KEY),this.ctx.storage.get<Record<string,any>>(MARKET_KEY),this.ctx.storage.get<Record<string,any>>(TECHNICAL_KEY),this.ctx.storage.get<Record<string,any>>(EVENT_STUDIES_KEY),this.ctx.storage.get<Record<string,any>>(META_KEY)]);"
new_state_read = "private async state(){const [calendar,macro,intelligence,market,technical,eventStudies,meta]=await Promise.all([this.ctx.storage.get<Record<string,any>>(CALENDAR_KEY),this.ctx.storage.get<Record<string,any>>(MACRO_KEY),this.readIntelligence(),this.ctx.storage.get<Record<string,any>>(MARKET_KEY),this.ctx.storage.get<Record<string,any>>(TECHNICAL_KEY),this.ctx.storage.get<Record<string,any>>(EVENT_STUDIES_KEY),this.ctx.storage.get<Record<string,any>>(META_KEY)]);"
if old_state_read in text:
    text = replace_once(text, old_state_read, new_state_read, 'durable object chunked intelligence read')

path.write_text(text, encoding='utf-8')
print('Large intelligence storage architecture applied to Firestore and Durable Object state.')
