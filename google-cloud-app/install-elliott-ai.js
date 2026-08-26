import { readFile, writeFile } from 'node:fs/promises';

const target=new URL('./server.js',import.meta.url);
let source=await readFile(target,'utf8');

function ensureReplace(needle,replacement,label){
  if(source.includes(replacement))return;
  if(!source.includes(needle))throw new Error(`FXGA Elliott AI installer could not find ${label}`);
  source=source.replace(needle,replacement);
}

ensureReplace(
  "import { createElliottReportService } from './elliott-reports.js';",
  "import { createElliottReportService } from './elliott-reports.js';\nimport { createElliottAiService } from './elliott-ai.js';",
  'Elliott report import anchor'
);
ensureReplace(
  "const elliottReportService=createElliottReportService({db,broadcast:event=>broadcastLiveEvent(event)});",
  "const elliottReportService=createElliottReportService({db,broadcast:event=>broadcastLiveEvent(event)});\nconst elliottAiService=createElliottAiService({db,broadcast:event=>broadcastLiveEvent(event)});",
  'Elliott report service anchor'
);
ensureReplace(
  "const elliottHandled=await elliottReportService.handle(req,res,url,sendJson,apiError);if(elliottHandled)return;if(req.method!=='GET')return apiError(res,405,'Method not allowed');",
  "const elliottHandled=await elliottReportService.handle(req,res,url,sendJson,apiError);if(elliottHandled)return;const elliottAiHandled=await elliottAiService.handle(req,res,url,sendJson,apiError);if(elliottAiHandled)return;if(req.method!=='GET')return apiError(res,405,'Method not allowed');",
  'Elliott report API handler anchor'
);
ensureReplace(
  "elliottReports:elliottReportService.health(),timestamp:new Date().toISOString()",
  "elliottReports:elliottReportService.health(),elliottAi:elliottAiService.health(),timestamp:new Date().toISOString()",
  'Elliott health anchor'
);

await writeFile(target,source,'utf8');
console.log('FXGA Elliott multimodal AI routes installed into server.js');
