import json
from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return text.replace(old, new, 1)

# Cloudflare hot cache for chunked intelligence state.
path=Path('worker/index-v3.ts')
text=path.read_text(encoding='utf-8')
if 'private intelligenceCache:any=null;' not in text:
    text=replace_once(text,
        'export class FxgaCoordinator extends DurableObject<Env>{\n  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);}\n',
        'export class FxgaCoordinator extends DurableObject<Env>{\n  private intelligenceCache:any=null;\n  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);}\n',
        'durable object intelligence cache property')
    text=replace_once(text,
        "private async readIntelligence(){const stored=await this.ctx.storage.get<any>(INTELLIGENCE_KEY);if(!stored?.chunked)return stored??null;",
        "private async readIntelligence(){if(this.intelligenceCache)return this.intelligenceCache;const stored=await this.ctx.storage.get<any>(INTELLIGENCE_KEY);if(!stored?.chunked){this.intelligenceCache=stored??null;return this.intelligenceCache;}",
        'cached intelligence read')
    text=replace_once(text,
        "if(Number(stored.charLength||0)&&serialized.length!==Number(stored.charLength))throw new Error('Intelligence chunk length mismatch');return JSON.parse(serialized);}",
        "if(Number(stored.charLength||0)&&serialized.length!==Number(stored.charLength))throw new Error('Intelligence chunk length mismatch');this.intelligenceCache=JSON.parse(serialized);return this.intelligenceCache;}",
        'cache reconstructed intelligence')
    text=replace_once(text,
        "if(serialized.length<=INTELLIGENCE_CHUNK_CHARS){await this.ctx.storage.put(INTELLIGENCE_KEY,payload);if(previous?.chunked)await this.deleteIntelligenceChunks(previous);return {chunked:false,charLength:serialized.length,chunkCount:1};}",
        "if(serialized.length<=INTELLIGENCE_CHUNK_CHARS){await this.ctx.storage.put(INTELLIGENCE_KEY,payload);this.intelligenceCache=payload;if(previous?.chunked)await this.deleteIntelligenceChunks(previous);return {chunked:false,charLength:serialized.length,chunkCount:1};}",
        'cache direct intelligence write')
    text=replace_once(text,
        "await this.ctx.storage.put(INTELLIGENCE_KEY,{chunked:true,version:1,generation,chunkCount:chunks.length,charLength:serialized.length,generatedAt:payload.generatedAt??new Date().toISOString()});if(previous?.chunked&&previous.generation!==generation)await this.deleteIntelligenceChunks(previous);return {chunked:true,charLength:serialized.length,chunkCount:chunks.length};}",
        "await this.ctx.storage.put(INTELLIGENCE_KEY,{chunked:true,version:1,generation,chunkCount:chunks.length,charLength:serialized.length,generatedAt:payload.generatedAt??new Date().toISOString()});this.intelligenceCache=payload;if(previous?.chunked&&previous.generation!==generation)await this.deleteIntelligenceChunks(previous);return {chunked:true,charLength:serialized.length,chunkCount:chunks.length};}",
        'cache chunked intelligence write')
path.write_text(text,encoding='utf-8')

# Runtime health version comes from the release package rather than a hard-coded integer.
path=Path('cloud-run-collector/src/super-runtime.js')
text=path.read_text(encoding='utf-8')
if "import { readFileSync } from 'node:fs';" not in text:
    text=replace_once(text,"import crypto from 'node:crypto';\n","import crypto from 'node:crypto';\nimport { readFileSync } from 'node:fs';\n",'runtime fs import')
if 'const SERVICE_VERSION=' not in text:
    anchor="const fredApiKey=process.env.FRED_API_KEY||'';\n"
    text=replace_once(text,anchor,anchor+"const SERVICE_VERSION=(()=>{try{const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));return String(pkg?.version||'0.0.0');}catch{return '0.0.0';}})();\n",'runtime service version')
if "version:SERVICE_VERSION" not in text:
    text=replace_once(text,"return {ok:true,service:'fxga-cloud-run-collector',version:4,architecture:","return {ok:true,service:'fxga-cloud-run-collector',version:SERVICE_VERSION,architecture:",'runtime health version')
path.write_text(text,encoding='utf-8')

# Promote the storage architecture patch as 4.14.1 and keep the lock metadata synchronized.
for filename in ['cloud-run-collector/package.json','cloud-run-collector/package-lock.json']:
    p=Path(filename);data=json.loads(p.read_text(encoding='utf-8'));data['version']='4.14.1'
    if filename.endswith('package-lock.json') and isinstance(data.get('packages'),dict) and isinstance(data['packages'].get(''),dict):data['packages']['']['version']='4.14.1'
    p.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
print('Durable Object hot cache, runtime version contract, and v4.14.1 metadata applied.')
