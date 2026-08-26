//+------------------------------------------------------------------+
//| FXGA Elliott Website Report Bridge EA v13.20                     |
//| On-demand MT5 screenshot uploader for the FXGA dashboard.        |
//| WebRequest is deliberately isolated in this EA because MT5       |
//| does not permit WebRequest from custom indicators.                |
//+------------------------------------------------------------------+
#property copyright "FX Global Avengers Trading Academy"
#property version   "13.21"
#property strict
#property description "EA Bridge v13.21 - safe idle initialization, authenticated on-demand Elliott screenshot/PDF bridge."

input group "WEBSITE • FXGA Elliott PDF Report Bridge"
input bool   InpWebsiteReportBridge=true;
input string InpWebsiteReportApiBase=""; // Example: https://fxga-macro-dashboard-xxxxx-uc.a.run.app
input string InpWebsiteReportSecret=""; // Must match GitHub Actions secret FXGA_MT5_REPORT_SECRET. Never hard-code it in source.
input string InpWebsiteReportTerminalId="FXGA-MT5-PRIMARY";
input int    InpWebsiteReportPollSeconds=5;
input int    InpWebsiteReportHttpTimeoutMs=60000;
input int    InpWebsiteReportChartLoadSeconds=4;
input int    InpWebsiteReportScreenshotWidth=1600;
input int    InpWebsiteReportScreenshotHeight=900;
input int    InpWebsiteReportMaxRetries=3;
input string InpWebsiteReportTemplateName="FXGA_Elliott_Web_Report_v13_20.tpl";
input bool   InpWebsiteReportVerbose=true;

enum ENUM_FXGA_WEB_REPORT_STAGE
  {
   FXGA_WEB_IDLE=0,
   FXGA_WEB_WAIT_RENDER=1,
   FXGA_WEB_COMPLETE=2
  };

ENUM_FXGA_WEB_REPORT_STAGE gWebStage=FXGA_WEB_IDLE;
bool     gWebChildMode=false;
bool     gWebOwnLock=false;
string   gWebApiBase="";
string   gWebJobId="";
string   gWebSymbol="";
string   gWebTimeframes[];
int      gWebTimeframeCount=0;
int      gWebTimeframeIndex=0;
long     gWebChildChartId=0;
ulong    gWebChildOpenedMs=0;
datetime gWebChildOpenedLocal=0;
string   gWebScreenshotFile="";
int      gWebRetryCount=0;
ulong    gWebLastPollMs=0;
ulong    gWebLastCompleteAttemptMs=0;
bool     gWebConfigReady=false;
string   gWebConfigIssue="";
bool     gWebConfigWarningPrinted=false;

string WebTrim(string value)
  {
   StringTrimLeft(value);
   StringTrimRight(value);
   return value;
  }

string WebNormalizeBase(string value)
  {
   value=WebTrim(value);
   while(StringLen(value)>0 && StringSubstr(value,StringLen(value)-1,1)=="/")
      value=StringSubstr(value,0,StringLen(value)-1);
   return value;
  }

string WebUrlEncode(const string value)
  {
   uchar bytes[];
   StringToCharArray(value,bytes,0,WHOLE_ARRAY,CP_UTF8);
   string out="";
   int n=ArraySize(bytes);
   if(n>0 && bytes[n-1]==0) n--;
   for(int i=0;i<n;i++)
     {
      uchar c=bytes[i];
      bool safe=((c>='A' && c<='Z') || (c>='a' && c<='z') || (c>='0' && c<='9') || c=='-' || c=='_' || c=='.' || c=='~');
      if(safe) out+=CharToString(c);
      else out+="%"+StringFormat("%02X",(int)c);
     }
   return out;
  }

string WebSanitizeFileToken(string value)
  {
   StringReplace(value,"/","_"); StringReplace(value,"\\","_");
   StringReplace(value,":","_"); StringReplace(value,"?","_");
   StringReplace(value,"&","_"); StringReplace(value,"=","_");
   StringReplace(value," ","_");
   return value;
  }

bool WebConfigValidate()
  {
   gWebConfigIssue="";
   if(!InpWebsiteReportBridge)
     {
      gWebConfigIssue="bridge disabled by input";
      return false;
     }

   gWebApiBase=WebNormalizeBase(InpWebsiteReportApiBase);

   if(gWebApiBase=="")
     {
      gWebConfigIssue="InpWebsiteReportApiBase is empty";
      return false;
     }
   if(StringFind(gWebApiBase,"https://")!=0 && StringFind(gWebApiBase,"http://")!=0)
     {
      gWebConfigIssue="InpWebsiteReportApiBase must begin with https:// or http://";
      return false;
     }
   if(WebTrim(InpWebsiteReportSecret)=="")
     {
      gWebConfigIssue="InpWebsiteReportSecret is empty";
      return false;
     }
   if(StringLen(WebTrim(InpWebsiteReportSecret))<16)
     {
      gWebConfigIssue="InpWebsiteReportSecret is too short; use the same strong secret configured on the website backend";
      return false;
     }
   if(InpWebsiteReportPollSeconds<1)
     {
      gWebConfigIssue="InpWebsiteReportPollSeconds must be at least 1";
      return false;
     }
   if(InpWebsiteReportHttpTimeoutMs<1000)
     {
      gWebConfigIssue="InpWebsiteReportHttpTimeoutMs must be at least 1000";
      return false;
     }
   if(InpWebsiteReportScreenshotWidth<640 || InpWebsiteReportScreenshotHeight<360)
     {
      gWebConfigIssue="screenshot dimensions are too small";
      return false;
     }
   return true;
  }

void WebPrintConfigurationGuide()
  {
   if(gWebConfigWarningPrinted) return;
   gWebConfigWarningPrinted=true;
   Print("EA Bridge v13.21 | CONFIGURATION REQUIRED | ",gWebConfigIssue);
   Print("EA Bridge | Set InpWebsiteReportApiBase to the FXGA Google Cloud Run API URL.");
   Print("EA Bridge | Set InpWebsiteReportSecret to the same private FXGA_MT5_REPORT_SECRET configured for the website backend.");
   Print("EA Bridge | Also add the Cloud Run base URL in MT5: Tools > Options > Expert Advisors > Allow WebRequest for listed URL.");
   Print("EA Bridge | The EA remains loaded and passive. It will not capture or upload screenshots while configuration is incomplete.");
  }

string WebLockKey() { return "FXGA_EW_WEB_REPORT_LOCK"; }
string WebHeartbeatKey() { return "FXGA_EW_WEB_REPORT_HEARTBEAT"; }
string WebChildKey(const long chart_id) { return "FXGA_EW_WEB_CHILD_"+IntegerToString((int)chart_id); }
string WebReadyKey(const long chart_id) { return "FXGA_EW_WEB_READY_"+IntegerToString((int)chart_id); }

bool WebAcquireWorkerLock()
  {
   if(gWebChildMode) return false;
   double now=(double)TimeLocal();
   string key=WebLockKey(),hb=WebHeartbeatKey();
   if(!GlobalVariableCheck(key))
     {
      GlobalVariableSet(key,(double)ChartID());
      GlobalVariableSet(hb,now);
      gWebOwnLock=true;
      return true;
     }
   long owner=(long)GlobalVariableGet(key);
   double last=(GlobalVariableCheck(hb) ? GlobalVariableGet(hb) : 0.0);
   if(owner==ChartID() || now-last>30.0)
     {
      GlobalVariableSet(key,(double)ChartID());
      GlobalVariableSet(hb,now);
      gWebOwnLock=true;
      return true;
     }
   gWebOwnLock=false;
   return false;
  }

void WebReleaseWorkerLock()
  {
   if(!gWebOwnLock) return;
   if(GlobalVariableCheck(WebLockKey()) && (long)GlobalVariableGet(WebLockKey())==ChartID())
     {
      GlobalVariableDel(WebLockKey());
      GlobalVariableDel(WebHeartbeatKey());
     }
   gWebOwnLock=false;
  }

int WebRequestText(const string method,const string path,const string body,string &response)
  {
   response="";
   if(gWebApiBase=="") return -1;
   string url=gWebApiBase+path;
   string headers="Accept: application/json\r\nX-FXGA-MT5-Secret: "+InpWebsiteReportSecret+"\r\n";
   if(method=="POST") headers+="Content-Type: application/json\r\n";
   char data[],result[];
   if(body!="") StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8);
   else ArrayResize(data,0);
   string response_headers="";
   ResetLastError();
   int status=WebRequest(method,url,headers,InpWebsiteReportHttpTimeoutMs,data,result,response_headers);
   if(ArraySize(result)>0) response=CharArrayToString(result,0,-1,CP_UTF8);
   if(status<0 && InpWebsiteReportVerbose)
      Print("EA Bridge HTTP error | ",GetLastError()," | ",method," ",url);
   return status;
  }

int WebRequestBinary(const string method,const string path,uchar &payload[],const string content_type,string &response)
  {
   response="";
   if(gWebApiBase=="") return -1;
   string url=gWebApiBase+path;
   string headers="Accept: application/json\r\nContent-Type: "+content_type+"\r\nX-FXGA-MT5-Secret: "+InpWebsiteReportSecret+"\r\n";
   char data[],result[];
   int n=ArraySize(payload);
   ArrayResize(data,n);
   for(int i=0;i<n;i++) data[i]=(char)payload[i];
   string response_headers="";
   ResetLastError();
   int status=WebRequest(method,url,headers,InpWebsiteReportHttpTimeoutMs,data,result,response_headers);
   if(ArraySize(result)>0) response=CharArrayToString(result,0,-1,CP_UTF8);
   if(status<0 && InpWebsiteReportVerbose)
      Print("EA Bridge binary HTTP error | ",GetLastError()," | ",method," ",url);
   return status;
  }

bool WebJsonString(const string json,const string key,string &value)
  {
   value="";
   string needle="\""+key+"\":\"";
   int p=StringFind(json,needle);
   if(p<0) return false;
   p+=StringLen(needle);
   int q=StringFind(json,"\"",p);
   if(q<0) return false;
   value=StringSubstr(json,p,q-p);
   return true;
  }

bool WebJsonNullJob(const string json)
  {
   return (StringFind(json,"\"job\":null")>=0 || StringFind(json,"\"job\" : null")>=0);
  }

bool WebJsonTimeframesCsv(const string json,string &csv)
  {
   csv="";
   if(WebJsonString(json,"timeframes_csv",csv)) return true;
   int p=StringFind(json,"\"timeframes\":[");
   if(p<0) return false;
   p=StringFind(json,"[",p)+1;
   int q=StringFind(json,"]",p);
   if(q<0) return false;
   string raw=StringSubstr(json,p,q-p);
   StringReplace(raw,"\"","");
   StringReplace(raw," ","");
   csv=raw;
   return (csv!="");
  }

ENUM_TIMEFRAMES WebTfFromName(const string tf)
  {
   if(tf=="M1") return PERIOD_M1; if(tf=="M2") return PERIOD_M2; if(tf=="M3") return PERIOD_M3; if(tf=="M4") return PERIOD_M4;
   if(tf=="M5") return PERIOD_M5; if(tf=="M6") return PERIOD_M6; if(tf=="M10") return PERIOD_M10; if(tf=="M12") return PERIOD_M12;
   if(tf=="M15") return PERIOD_M15; if(tf=="M20") return PERIOD_M20; if(tf=="M30") return PERIOD_M30;
   if(tf=="H1") return PERIOD_H1; if(tf=="H2") return PERIOD_H2; if(tf=="H3") return PERIOD_H3; if(tf=="H4") return PERIOD_H4;
   if(tf=="H6") return PERIOD_H6; if(tf=="H8") return PERIOD_H8; if(tf=="H12") return PERIOD_H12;
   if(tf=="D1") return PERIOD_D1; if(tf=="W1") return PERIOD_W1; if(tf=="MN1") return PERIOD_MN1;
   return PERIOD_CURRENT;
  }

void WebResetJob()
  {
   if(gWebChildChartId>0) ChartClose(gWebChildChartId);
   gWebChildChartId=0;
   gWebJobId="";
   gWebSymbol="";
   ArrayResize(gWebTimeframes,0);
   gWebTimeframeCount=0;
   gWebTimeframeIndex=0;
   gWebRetryCount=0;
   gWebStage=FXGA_WEB_IDLE;
  }

void WebFailJob(const string reason)
  {
   if(gWebJobId!="")
     {
      string response="";
      string path="/api/elliott-reports/fail?jobId="+WebUrlEncode(gWebJobId)+"&terminalId="+WebUrlEncode(InpWebsiteReportTerminalId);
      string body="{\"error\":\""+reason+"\"}";
      WebRequestText("POST",path,body,response);
     }
   Print("EA Bridge job failed | ",reason);
   WebResetJob();
  }

bool WebStartCurrentTimeframe()
  {
   if(gWebTimeframeIndex<0 || gWebTimeframeIndex>=gWebTimeframeCount) return false;
   string tf_name=gWebTimeframes[gWebTimeframeIndex];
   ENUM_TIMEFRAMES tf=WebTfFromName(tf_name);
   if(tf==PERIOD_CURRENT && tf_name!="H1") return false;
   long chart=ChartOpen(gWebSymbol,tf);
   if(chart<=0) return false;
   gWebChildChartId=chart;
   GlobalVariableSet(WebChildKey(chart),1.0);
   GlobalVariableDel(WebReadyKey(chart));
   ChartSetInteger(chart,CHART_SHOW_GRID,false);
   ChartSetInteger(chart,CHART_AUTOSCROLL,true);
   ChartSetInteger(chart,CHART_SHIFT,true);
   if(InpWebsiteReportTemplateName!="")
     {
      ResetLastError();
      bool applied=ChartApplyTemplate(chart,InpWebsiteReportTemplateName);
      if(!applied && InpWebsiteReportVerbose)
         Print("EA Bridge template warning | ",InpWebsiteReportTemplateName," | err=",GetLastError());
     }
   ChartRedraw(chart);
   gWebChildOpenedMs=GetTickCount64();
   gWebChildOpenedLocal=TimeLocal();
   gWebStage=FXGA_WEB_WAIT_RENDER;
   return true;
  }

bool WebReadFileBytes(const string filename,uchar &bytes[])
  {
   int h=FileOpen(filename,FILE_READ|FILE_BIN);
   if(h==INVALID_HANDLE) return false;
   int size=(int)FileSize(h);
   if(size<=0) { FileClose(h); return false; }
   ArrayResize(bytes,size);
   for(int i=0;i<size;i++) bytes[i]=(uchar)FileReadInteger(h,CHAR_VALUE);
   FileClose(h);
   return true;
  }

bool WebCaptureAndUpload()
  {
   if(gWebChildChartId<=0 || gWebTimeframeIndex>=gWebTimeframeCount) return false;
   string tf=gWebTimeframes[gWebTimeframeIndex];
   gWebScreenshotFile="FXGA_Elliott_Web_"+WebSanitizeFileToken(gWebJobId)+"_"+tf+".png";
   ChartRedraw(gWebChildChartId);
   Sleep(250);
   ResetLastError();
   bool shot=ChartScreenShot(gWebChildChartId,gWebScreenshotFile,InpWebsiteReportScreenshotWidth,InpWebsiteReportScreenshotHeight,ALIGN_RIGHT);
   if(!shot)
     {
      if(InpWebsiteReportVerbose) Print("EA Bridge screenshot failed | ",tf," | err=",GetLastError());
      return false;
     }
   uchar bytes[];
   if(!WebReadFileBytes(gWebScreenshotFile,bytes)) return false;
   string response="";
   string path="/api/elliott-reports/upload?jobId="+WebUrlEncode(gWebJobId)+"&timeframe="+WebUrlEncode(tf)+"&terminalId="+WebUrlEncode(InpWebsiteReportTerminalId);
   int status=WebRequestBinary("POST",path,bytes,"image/png",response);
   FileDelete(gWebScreenshotFile);
   if(status<200 || status>=300)
     {
      if(InpWebsiteReportVerbose) Print("EA Bridge upload failed | ",tf," | HTTP=",status," | ",response);
      return false;
     }
   if(InpWebsiteReportVerbose) Print("EA Bridge uploaded | ",gWebSymbol," ",tf," | bytes=",ArraySize(bytes));
   return true;
  }

void WebAdvanceTimeframe()
  {
   if(gWebChildChartId>0)
     {
      GlobalVariableDel(WebChildKey(gWebChildChartId));
      GlobalVariableDel(WebReadyKey(gWebChildChartId));
      ChartClose(gWebChildChartId);
     }
   gWebChildChartId=0;
   gWebRetryCount=0;
   gWebTimeframeIndex++;
   if(gWebTimeframeIndex>=gWebTimeframeCount)
     {
      gWebStage=FXGA_WEB_COMPLETE;
      return;
     }
   if(!WebStartCurrentTimeframe())
      WebFailJob("Could not open next MT5 timeframe chart");
  }

void WebProcessRenderWait()
  {
   if(gWebChildChartId<=0) { WebFailJob("Temporary MT5 chart disappeared"); return; }
   bool ready=(GlobalVariableCheck(WebReadyKey(gWebChildChartId)) && GlobalVariableGet(WebReadyKey(gWebChildChartId))>0.0);
   ulong elapsed=GetTickCount64()-gWebChildOpenedMs;
   ulong minimum=(ulong)MathMax(1,InpWebsiteReportChartLoadSeconds)*1000;
   if(!ready && elapsed<minimum) return;
   if(!ready && elapsed<minimum+8000) return;
   if(!WebCaptureAndUpload())
     {
      gWebRetryCount++;
      if(gWebRetryCount>=MathMax(1,InpWebsiteReportMaxRetries)) { WebFailJob("Screenshot/upload failed after retries"); return; }
      gWebChildOpenedMs=GetTickCount64();
      return;
     }
   WebAdvanceTimeframe();
  }

void WebCompleteJob()
  {
   ulong now=GetTickCount64();
   if(now-gWebLastCompleteAttemptMs<2000) return;
   gWebLastCompleteAttemptMs=now;
   string response="";
   string path="/api/elliott-reports/complete?jobId="+WebUrlEncode(gWebJobId)+"&terminalId="+WebUrlEncode(InpWebsiteReportTerminalId);
   int status=WebRequestText("POST",path,"{}",response);
   if(status>=200 && status<300)
     {
      Print("EA Bridge PDF READY | ",gWebSymbol," | job=",gWebJobId);
      WebResetJob();
      return;
     }
   if(status==409) return;
   gWebRetryCount++;
   if(gWebRetryCount>=MathMax(1,InpWebsiteReportMaxRetries)) WebFailJob("Cloud PDF assembly failed");
  }

void WebPollForJob()
  {
   ulong now=GetTickCount64();
   if(now-gWebLastPollMs<(ulong)MathMax(1,InpWebsiteReportPollSeconds)*1000) return;
   gWebLastPollMs=now;
   GlobalVariableSet(WebHeartbeatKey(),(double)TimeLocal());
   string response="";
   string path="/api/elliott-reports/jobs/next?terminalId="+WebUrlEncode(InpWebsiteReportTerminalId);
   int status=WebRequestText("GET",path,"",response);
   if(status<200 || status>=300) return;
   if(WebJsonNullJob(response)) return;
   string job_id="",symbol="",csv="";
   if(!WebJsonString(response,"id",job_id) || !WebJsonString(response,"symbol",symbol) || !WebJsonTimeframesCsv(response,csv)) return;
   string frames[];
   int count=StringSplit(csv,',',frames);
   if(count<=0) return;
   gWebJobId=job_id;
   gWebSymbol=symbol;
   ArrayResize(gWebTimeframes,count);
   gWebTimeframeCount=0;
   for(int i=0;i<count;i++)
     {
      string tf=WebTrim(frames[i]);
      if(tf=="") continue;
      gWebTimeframes[gWebTimeframeCount++]=tf;
     }
   ArrayResize(gWebTimeframes,gWebTimeframeCount);
   gWebTimeframeIndex=0;
   gWebRetryCount=0;
   Print("EA Bridge ANALYZE JOB | ",gWebSymbol," | timeframes=",gWebTimeframeCount," | job=",gWebJobId);
   if(!WebStartCurrentTimeframe()) WebFailJob("Could not open first MT5 timeframe chart");
  }

int OnInit()
  {
   gWebApiBase=WebNormalizeBase(InpWebsiteReportApiBase);
   gWebChildMode=GlobalVariableCheck(WebChildKey(ChartID()));

   // Child charts created for screenshot rendering must always initialize
   // passively even if the parent bridge is temporarily unconfigured.
   if(gWebChildMode)
     {
      if(InpWebsiteReportVerbose)
         Print("EA Bridge v13.21 | child capture chart passive | chart=",ChartID());
      return INIT_SUCCEEDED;
     }

   EventSetTimer(1);

   if(!InpWebsiteReportBridge)
     {
      gWebConfigReady=false;
      gWebConfigIssue="bridge disabled by input";
      Print("EA Bridge v13.21 | loaded successfully | bridge disabled");
      return INIT_SUCCEEDED;
     }

   gWebConfigReady=WebConfigValidate();

   if(!gWebConfigReady)
     {
      // v13.21: keep the EA attached instead of failing initialization.
      // Staying attached makes configuration failures visible and prevents
      // MT5 from immediately removing the EA from the chart.
      WebPrintConfigurationGuide();
      return INIT_SUCCEEDED;
     }

   WebAcquireWorkerLock();
   Print("EA Bridge v13.21 | READY | terminal=",InpWebsiteReportTerminalId,
         " | API=",gWebApiBase,
         " | screenshots occur ONLY after a website Analyze job");
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   if(gWebChildChartId>0) ChartClose(gWebChildChartId);
   WebReleaseWorkerLock();
  }

void OnTick() {}

void OnTimer()
  {
   if(gWebChildMode || !InpWebsiteReportBridge) return;

   if(!gWebConfigReady)
     {
      // Inputs are reapplied by MT5 through reinitialization, so there is no
      // network activity while configuration is incomplete.
      if(!gWebConfigWarningPrinted) WebPrintConfigurationGuide();
      return;
     }

   if(!WebAcquireWorkerLock()) return;
   if(gWebStage==FXGA_WEB_IDLE) { WebPollForJob(); return; }
   if(gWebStage==FXGA_WEB_WAIT_RENDER) { WebProcessRenderWait(); return; }
   if(gWebStage==FXGA_WEB_COMPLETE) { WebCompleteJob(); return; }
  }
