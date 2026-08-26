import crypto from 'node:crypto';
import { FieldValue } from '@google-cloud/firestore';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const DEFAULT_TIMEFRAMES=['M1','M2','M3','M4','M5','M6','M10','M12','M15','M20','M30','H1','H2','H3','H4','H6','H8','H12','D1','W1','MN1'];
const TIMEFRAME_SET=new Set(DEFAULT_TIMEFRAMES);
const JOBS='fxga_elliott_report_jobs';
const REPORTS='fxga_elliott_reports';
const META='fxga_elliott_report_meta';
const BLOBS='fxga_elliott_report_blobs';
const MAX_SCREENSHOT_BYTES=8*1024*1024;
const MAX_JSON_BYTES=64*1024;
const BLOB_CHUNK_BYTES=700*1024;
const WRITE_BATCH_MAX=400;
const CLAIM_STALE_MS=20*60*1000;
const BRIDGE_ONLINE_MS=30000;
const REQUEST_WINDOW_MS=60000;
const REQUESTS_PER_WINDOW=5;

function toIso(value){
  if(!value)return null;
  if(typeof value==='string')return value;
  if(value instanceof Date)return value.toISOString();
  if(typeof value?.toDate==='function')return value.toDate().toISOString();
  if(typeof value?._seconds==='number')return new Date(value._seconds*1000).toISOString();
  return null;
}
function safeId(value,max=80){return String(value??'').trim().replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,max);}
function safeSymbol(value){return safeId(String(value??'XAUUSD').toUpperCase(),32)||'XAUUSD';}
function normalizeTimeframes(value){
  const raw=Array.isArray(value)?value:String(value??'').split(',');
  const unique=[];
  for(const item of raw){
    const tf=String(item??'').trim().toUpperCase();
    if(TIMEFRAME_SET.has(tf)&&!unique.includes(tf))unique.push(tf);
  }
  return unique.length?unique:[...DEFAULT_TIMEFRAMES];
}
function requestIp(req){return String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();}
function secretEqual(received,expected){
  const a=Buffer.from(String(received??'')),b=Buffer.from(String(expected??''));
  return a.length===b.length&&a.length>0&&crypto.timingSafeEqual(a,b);
}
async function readBody(req,maxBytes){
  const chunks=[];let total=0;
  for await(const chunk of req){
    total+=chunk.length;
    if(total>maxBytes)throw Object.assign(new Error('Request body too large'),{statusCode:413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function readJson(req){
  const body=await readBody(req,MAX_JSON_BYTES);
  if(!body.length)return{};
  try{return JSON.parse(body.toString('utf8'));}
  catch{throw Object.assign(new Error('Invalid JSON body'),{statusCode:400});}
}
function reportFileName(symbol,createdAt){
  const stamp=new Date(createdAt||Date.now()).toISOString().replace(/[:.]/g,'-');
  return `FXGA_Elliott_${safeSymbol(symbol)}_${stamp}.pdf`;
}
function publicJob(doc){
  const d=doc.data?.()??doc;
  return{
    id:doc.id??d.id,status:d.status??'UNKNOWN',symbol:d.symbol??'',
    timeframes:d.timeframes??[],uploadedTimeframes:d.uploadedTimeframes??[],
    createdAt:toIso(d.createdAt),updatedAt:toIso(d.updatedAt),
    claimedAt:toIso(d.claimedAt),completedAt:toIso(d.completedAt),
    terminalId:d.terminalId??null,error:d.error??null,reportId:d.reportId??null
  };
}
function publicReport(doc){
  const d=doc.data?.()??doc,id=doc.id??d.id;
  return{
    id,symbol:d.symbol??'',timeframes:d.timeframes??[],pageCount:Number(d.pageCount??0),
    createdAt:toIso(d.createdAt),completedAt:toIso(d.completedAt),
    fileName:d.fileName??'FXGA_Elliott_Report.pdf',
    pdfUrl:`/api/elliott-reports/${encodeURIComponent(id)}/pdf`
  };
}

export function createElliottReportService({db,broadcast=()=>{}}={}){
  if(!db)throw new Error('createElliottReportService requires Firestore');
  const jobs=db.collection(JOBS),reports=db.collection(REPORTS),meta=db.collection(META),blobs=db.collection(BLOBS);
  const requestWindows=new Map();

  function requireMt5(req){
    const expected=String(process.env.FXGA_MT5_REPORT_SECRET||'');
    if(!expected)throw Object.assign(new Error('MT5 report bridge secret is not configured'),{statusCode:503});
    if(!secretEqual(req.headers['x-fxga-mt5-secret'],expected))
      throw Object.assign(new Error('Unauthorized MT5 report bridge'),{statusCode:401});
  }
  function allowRequest(req){
    const key=requestIp(req),now=Date.now();let entry=requestWindows.get(key);
    if(!entry||now-entry.start>=REQUEST_WINDOW_MS)entry={start:now,count:0};
    entry.count+=1;requestWindows.set(key,entry);
    if(entry.count>REQUESTS_PER_WINDOW)
      throw Object.assign(new Error('Too many report requests; wait a minute and try again'),{statusCode:429});
  }
  async function heartbeat(terminalId){
    await meta.doc('bridge').set({terminalId,lastTerminalSeen:new Date(),updatedAt:new Date()},{merge:true});
  }
  async function bridgeState(){
    const snap=await meta.doc('bridge').get();
    if(!snap.exists)return{online:false,lastSeen:null,terminalId:null};
    const d=snap.data(),last=toIso(d.lastTerminalSeen),ms=last?Date.parse(last):0;
    return{online:Boolean(ms&&Date.now()-ms<BRIDGE_ONLINE_MS),lastSeen:last,terminalId:d.terminalId??null};
  }

  function blobRef(blobId){return blobs.doc(safeId(blobId,140));}
  function chunkId(index){return String(index).padStart(6,'0');}
  async function deleteBlob(blobId){
    if(!blobId)return;
    const ref=blobRef(blobId),snap=await ref.get();
    if(!snap.exists)return;
    const count=Number(snap.data()?.chunkCount||0);
    for(let start=0;start<count;start+=WRITE_BATCH_MAX){
      const batch=db.batch();
      for(let i=start;i<Math.min(count,start+WRITE_BATCH_MAX);i++)
        batch.delete(ref.collection('chunks').doc(chunkId(i)));
      await batch.commit();
    }
    await ref.delete();
  }
  async function writeBlob(blobId,bytes,{contentType='application/octet-stream',kind='binary',jobId=null,timeframe=null}={}){
    const data=Buffer.from(bytes);
    await deleteBlob(blobId);
    const ref=blobRef(blobId),chunkCount=Math.ceil(data.length/BLOB_CHUNK_BYTES);
    await ref.set({
      id:safeId(blobId,140),contentType,kind,jobId,timeframe,
      byteLength:data.length,chunkBytes:BLOB_CHUNK_BYTES,chunkCount,
      createdAt:new Date(),storage:'firestore-private-chunks'
    });
    for(let start=0;start<chunkCount;start+=WRITE_BATCH_MAX){
      const batch=db.batch();
      for(let i=start;i<Math.min(chunkCount,start+WRITE_BATCH_MAX);i++){
        const begin=i*BLOB_CHUNK_BYTES,end=Math.min(data.length,begin+BLOB_CHUNK_BYTES);
        batch.set(ref.collection('chunks').doc(chunkId(i)),{index:i,bytes:data.subarray(begin,end)});
      }
      await batch.commit();
    }
    return{blobId:safeId(blobId,140),byteLength:data.length,chunkCount,contentType};
  }
  async function readBlob(blobId){
    const ref=blobRef(blobId),metaSnap=await ref.get();
    if(!metaSnap.exists)throw Object.assign(new Error(`Private report blob ${blobId} is missing`),{statusCode:404});
    const m=metaSnap.data(),count=Number(m.chunkCount||0),parts=[];
    for(let start=0;start<count;start+=100){
      const refs=[];
      for(let i=start;i<Math.min(count,start+100);i++)refs.push(ref.collection('chunks').doc(chunkId(i)));
      const snaps=await db.getAll(...refs);
      for(const snap of snaps){
        if(!snap.exists)throw Object.assign(new Error(`Private report blob ${blobId} is incomplete`),{statusCode:500});
        parts.push(Buffer.from(snap.data().bytes));
      }
    }
    const bytes=Buffer.concat(parts);
    if(Number(m.byteLength||bytes.length)!==bytes.length)
      throw Object.assign(new Error(`Private report blob ${blobId} failed length verification`),{statusCode:500});
    return{bytes,meta:m};
  }

  async function recoverStaleClaims(){
    const snap=await jobs.where('status','==','CAPTURING').limit(25).get(),now=Date.now(),writes=[];
    for(const doc of snap.docs){
      const d=doc.data(),claimed=toIso(d.claimedAt),ms=claimed?Date.parse(claimed):0;
      if(ms&&now-ms>CLAIM_STALE_MS)
        writes.push(doc.ref.update({status:'PENDING',terminalId:null,claimedAt:null,updatedAt:new Date(),recoveredFromStaleClaim:true}));
    }
    if(writes.length)await Promise.allSettled(writes);
  }
  async function getActiveTerminalJob(terminalId){
    const snap=await jobs.where('terminalId','==',terminalId).limit(20).get();
    const active=snap.docs.filter(doc=>doc.data()?.status==='CAPTURING')
      .sort((a,b)=>Date.parse(toIso(a.data()?.claimedAt)||0)-Date.parse(toIso(b.data()?.claimedAt)||0));
    return active[0]??null;
  }
  async function claimPendingJob(terminalId){
    const snap=await jobs.where('status','==','PENDING').limit(20).get();
    const candidates=[...snap.docs].sort((a,b)=>Date.parse(toIso(a.data()?.createdAt)||0)-Date.parse(toIso(b.data()?.createdAt)||0));
    for(const candidate of candidates){
      const claimed=await db.runTransaction(async tx=>{
        const fresh=await tx.get(candidate.ref);
        if(!fresh.exists||fresh.data()?.status!=='PENDING')return false;
        tx.update(candidate.ref,{status:'CAPTURING',terminalId,claimedAt:new Date(),updatedAt:new Date(),uploadedTimeframes:[],images:{}});
        return true;
      });
      if(claimed)return candidate.ref.get();
    }
    return null;
  }

  async function buildPdf(jobId,job){
    const pdf=await PDFDocument.create();
    const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
    pdf.setTitle(`FXGA Elliott Wave Multi-Timeframe Analysis - ${job.symbol}`);
    pdf.setAuthor('FX Global Avengers Trading Academy');
    pdf.setSubject('Strict non-repainting Elliott Wave chart screenshots');
    const pageW=842,pageH=595,margin=18,headerH=42;
    for(let index=0;index<job.timeframes.length;index++){
      const tf=job.timeframes[index],blobId=job.images?.[tf];
      if(!blobId)throw Object.assign(new Error(`Missing uploaded screenshot for ${tf}`),{statusCode:409});
      const {bytes:imageBytes}=await readBlob(blobId);
      const image=await pdf.embedPng(imageBytes);
      const page=pdf.addPage([pageW,pageH]);
      page.drawRectangle({x:0,y:0,width:pageW,height:pageH,color:rgb(0.035,0.045,0.065)});
      page.drawText('FXGA ELLIOTT WAVE ANALYSIS',{x:margin,y:pageH-25,size:13,font:bold,color:rgb(0.92,0.78,0.28)});
      page.drawText(`${job.symbol}  |  ${tf}  |  ${index+1}/${job.timeframes.length}`,{x:pageW-margin-230,y:pageH-24,size:9,font:regular,color:rgb(0.82,0.85,0.90)});
      const maxW=pageW-margin*2,maxH=pageH-headerH-margin*2;
      const scale=Math.min(maxW/image.width,maxH/image.height),w=image.width*scale,h=image.height*scale;
      page.drawImage(image,{x:(pageW-w)/2,y:margin+(maxH-h)/2,width:w,height:h});
    }
    const bytes=Buffer.from(await pdf.save({useObjectStreams:true}));
    const fileName=reportFileName(job.symbol,job.createdAt?.toDate?.()??job.createdAt??Date.now());
    const pdfBlobId=`${jobId}__pdf`;
    const stored=await writeBlob(pdfBlobId,bytes,{contentType:'application/pdf',kind:'elliott-pdf',jobId});
    return{pdfBlobId:stored.blobId,fileName,pageCount:job.timeframes.length,byteLength:bytes.length,chunkCount:stored.chunkCount};
  }

  async function cleanupScreenshots(job){
    const ids=Object.values(job.images||{}).map(String);
    await Promise.allSettled(ids.map(id=>deleteBlob(id)));
  }

  async function handle(req,res,url,sendJson,apiError){
    if(!url.pathname.startsWith('/api/elliott-reports'))return false;
    try{
      if(req.method==='POST'&&url.pathname==='/api/elliott-reports/request'){
        allowRequest(req);
        const body=await readJson(req),symbol=safeSymbol(body.symbol),timeframes=normalizeTimeframes(body.timeframes),id=crypto.randomUUID(),now=new Date();
        await jobs.doc(id).set({id,status:'PENDING',symbol,timeframes,uploadedTimeframes:[],images:{},createdAt:now,updatedAt:now,requestIp:requestIp(req),source:'website-analyze-button'});
        broadcast({type:'elliott-report-job',action:'created',jobId:id,symbol,timeframes,at:now.toISOString()});
        return sendJson(res,202,{ok:true,job:publicJob({id,data:()=>({id,status:'PENDING',symbol,timeframes,uploadedTimeframes:[],createdAt:now,updatedAt:now})})});
      }

      if(req.method==='GET'&&url.pathname==='/api/elliott-reports/jobs/next'){
        requireMt5(req);
        const terminalId=safeId(url.searchParams.get('terminalId')||'FXGA-MT5-PRIMARY',80);
        await heartbeat(terminalId);await recoverStaleClaims();
        let job=await getActiveTerminalJob(terminalId);
        if(!job)job=await claimPendingJob(terminalId);
        if(!job)return sendJson(res,200,{ok:true,job:null});
        const d=job.data();
        return sendJson(res,200,{ok:true,job:{id:job.id,symbol:d.symbol,timeframes:d.timeframes,timeframes_csv:(d.timeframes||[]).join(','),status:d.status}});
      }

      const jobMatch=url.pathname.match(/^\/api\/elliott-reports\/jobs\/([^/]+)$/);
      if(req.method==='GET'&&jobMatch){
        const snap=await jobs.doc(jobMatch[1]).get();
        if(!snap.exists)return apiError(res,404,'Elliott report job not found');
        return sendJson(res,200,{ok:true,job:publicJob(snap)});
      }

      if(req.method==='POST'&&url.pathname==='/api/elliott-reports/upload'){
        requireMt5(req);
        const jobId=safeId(url.searchParams.get('jobId'),80),tf=String(url.searchParams.get('timeframe')||'').toUpperCase(),terminalId=safeId(url.searchParams.get('terminalId')||'',80);
        if(!jobId||!TIMEFRAME_SET.has(tf))return apiError(res,400,'Valid jobId and timeframe are required');
        const ref=jobs.doc(jobId),snap=await ref.get();
        if(!snap.exists)return apiError(res,404,'Elliott report job not found');
        const job=snap.data();
        if(job.status!=='CAPTURING')return apiError(res,409,`Job is ${job.status}, not CAPTURING`);
        if(job.terminalId&&terminalId&&job.terminalId!==terminalId)return apiError(res,409,'Job belongs to another MT5 terminal');
        if(!job.timeframes?.includes(tf))return apiError(res,400,'Timeframe is not part of this job');
        const png=await readBody(req,MAX_SCREENSHOT_BYTES);
        if(png.length<64||png[0]!==0x89||png[1]!==0x50||png[2]!==0x4e||png[3]!==0x47)return apiError(res,400,'Screenshot body is not a PNG image');
        const blobId=`${jobId}__${tf}`;
        await writeBlob(blobId,png,{contentType:'image/png',kind:'elliott-screenshot',jobId,timeframe:tf});
        await ref.update({[`images.${tf}`]:blobId,uploadedTimeframes:FieldValue.arrayUnion(tf),updatedAt:new Date(),storage:'firestore-private-chunks'});
        return sendJson(res,200,{ok:true,jobId,timeframe:tf,bytes:png.length,storage:'firestore-private-chunks'});
      }

      if(req.method==='POST'&&url.pathname==='/api/elliott-reports/complete'){
        requireMt5(req);
        const jobId=safeId(url.searchParams.get('jobId'),80),terminalId=safeId(url.searchParams.get('terminalId')||'',80);
        if(!jobId)return apiError(res,400,'jobId is required');
        const ref=jobs.doc(jobId),snap=await ref.get();
        if(!snap.exists)return apiError(res,404,'Elliott report job not found');
        const job=snap.data();
        if(job.terminalId&&terminalId&&job.terminalId!==terminalId)return apiError(res,409,'Job belongs to another MT5 terminal');
        const missing=(job.timeframes||[]).filter(tf=>!job.images?.[tf]);
        if(missing.length)return sendJson(res,409,{error:'Screenshots are still missing',missing});
        const generated=await buildPdf(jobId,job),now=new Date();
        await reports.doc(jobId).set({
          id:jobId,symbol:job.symbol,timeframes:job.timeframes,pageCount:generated.pageCount,
          byteLength:generated.byteLength,pdfBlobId:generated.pdfBlobId,pdfChunkCount:generated.chunkCount,
          fileName:generated.fileName,createdAt:job.createdAt??now,completedAt:now,sourceJobId:jobId,
          visibility:'website-only-private-firestore',storage:'firestore-private-chunks'
        });
        await ref.update({
          status:'READY',reportId:jobId,pdfBlobId:generated.pdfBlobId,fileName:generated.fileName,
          completedAt:now,updatedAt:now,storage:'firestore-private-chunks'
        });
        await cleanupScreenshots(job);
        broadcast({type:'elliott-report-ready',reportId:jobId,symbol:job.symbol,pageCount:generated.pageCount,at:now.toISOString()});
        return sendJson(res,200,{ok:true,report:publicReport({id:jobId,data:()=>({symbol:job.symbol,timeframes:job.timeframes,pageCount:generated.pageCount,fileName:generated.fileName,createdAt:job.createdAt,completedAt:now})})});
      }

      if(req.method==='POST'&&url.pathname==='/api/elliott-reports/fail'){
        requireMt5(req);
        const jobId=safeId(url.searchParams.get('jobId'),80),terminalId=safeId(url.searchParams.get('terminalId')||'',80),body=await readJson(req);
        if(!jobId)return apiError(res,400,'jobId is required');
        const ref=jobs.doc(jobId),snap=await ref.get();
        if(!snap.exists)return apiError(res,404,'Elliott report job not found');
        const job=snap.data();
        if(job.terminalId&&terminalId&&job.terminalId!==terminalId)return apiError(res,409,'Job belongs to another MT5 terminal');
        await ref.update({status:'FAILED',error:String(body.error||'MT5 capture failed').slice(0,1000),updatedAt:new Date(),completedAt:new Date()});
        await cleanupScreenshots(job);
        return sendJson(res,200,{ok:true});
      }

      if(req.method==='GET'&&url.pathname==='/api/elliott-reports'){
        const snap=await reports.limit(50).get();
        const items=snap.docs.map(publicReport).sort((a,b)=>Date.parse(b.completedAt||0)-Date.parse(a.completedAt||0));
        return sendJson(res,200,{ok:true,reports:items,bridge:await bridgeState(),timeframes:[...DEFAULT_TIMEFRAMES],storage:'firestore-private-chunks'});
      }

      const pdfMatch=url.pathname.match(/^\/api\/elliott-reports\/([^/]+)\/pdf$/);
      if(req.method==='GET'&&pdfMatch){
        const reportId=safeId(pdfMatch[1],80),snap=await reports.doc(reportId).get();
        if(!snap.exists)return apiError(res,404,'Elliott PDF report not found');
        const report=snap.data(),blobId=report.pdfBlobId;
        if(!blobId)return apiError(res,404,'Elliott PDF payload is missing');
        const {bytes}=await readBlob(blobId);
        res.statusCode=200;
        res.setHeader('Content-Type','application/pdf');
        res.setHeader('Content-Length',String(bytes.length));
        res.setHeader('Content-Disposition',`inline; filename="${String(report.fileName||'FXGA_Elliott_Report.pdf').replace(/["\r\n]/g,'_')}"`);
        res.setHeader('Cache-Control','private, no-store, max-age=0');
        res.end(bytes);
        return true;
      }

      return false;
    }catch(error){
      const status=Number(error?.statusCode||500),message=status>=500?'Elliott report service error':String(error?.message||error);
      console.error('FXGA Elliott report service error',error);
      return apiError(res,status,message);
    }
  }

  function health(){
    return{
      enabled:true,defaultTimeframes:DEFAULT_TIMEFRAMES.length,onDemandOnly:true,
      storage:'Google Cloud Firestore private chunk storage',
      authentication:'X-FXGA-MT5-Secret',
      screenshotMaxBytes:MAX_SCREENSHOT_BYTES,
      chunkBytes:BLOB_CHUNK_BYTES
    };
  }

  return{handle,health};
}
