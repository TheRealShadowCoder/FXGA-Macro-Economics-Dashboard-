import { readFile, writeFile } from 'node:fs/promises';

const target=new URL('./server.js',import.meta.url);
let source=await readFile(target,'utf8');

function ensureReplace(needle,replacement,label){
  if(source.includes(replacement))return;
  if(!source.includes(needle))throw new Error(`FXGA Elliott installer could not find ${label}`);
  source=source.replace(needle,replacement);
}

ensureReplace(
  "import { createTradingViewSignalService } from './tradingview-signals.js';",
  "import { createTradingViewSignalService } from './tradingview-signals.js';\nimport { createElliottReportService } from './elliott-reports.js';",
  'TradingView import anchor'
);
ensureReplace(
  "const tradingViewSignalService=createTradingViewSignalService({db,broadcast:event=>broadcastLiveEvent(event)});",
  "const tradingViewSignalService=createTradingViewSignalService({db,broadcast:event=>broadcastLiveEvent(event)});\nconst elliottReportService=createElliottReportService({db,broadcast:event=>broadcastLiveEvent(event)});",
  'service creation anchor'
);
ensureReplace(
  "'Access-Control-Allow-Headers':'Accept, Cache-Control, Content-Type, X-FXGA-Webhook-Secret'",
  "'Access-Control-Allow-Headers':'Accept, Cache-Control, Content-Type, X-FXGA-Webhook-Secret, X-FXGA-MT5-Secret'",
  'CORS header anchor'
);
ensureReplace(
  "const signalHandled=await tradingViewSignalService.handle(req,res,url,sendJson,apiError);if(signalHandled)return;if(req.method!=='GET')return apiError(res,405,'Method not allowed');",
  "const signalHandled=await tradingViewSignalService.handle(req,res,url,sendJson,apiError);if(signalHandled)return;const elliottHandled=await elliottReportService.handle(req,res,url,sendJson,apiError);if(elliottHandled)return;if(req.method!=='GET')return apiError(res,405,'Method not allowed');",
  'API handler anchor'
);
ensureReplace(
  "tradingViewSignals:tradingViewSignalService.health(),timestamp:new Date().toISOString()",
  "tradingViewSignals:tradingViewSignalService.health(),elliottReports:elliottReportService.health(),timestamp:new Date().toISOString()",
  'health payload anchor'
);

await writeFile(target,source,'utf8');
console.log('FXGA Elliott report routes installed into server.js');
