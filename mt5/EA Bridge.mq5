//+------------------------------------------------------------------+
//| FXGA Elliott Website Report Bridge EA v13.22                     |
//| On-demand MT5 screenshot uploader for the FXGA dashboard.        |
//| WebRequest is deliberately isolated in this EA because MT5       |
//| does not permit WebRequest from custom indicators.                |
//+------------------------------------------------------------------+
#property copyright "FX Global Avengers Trading Academy"
#property version   "13.22"
#property strict
#property description "EA Bridge v13.22 - production API preconfigured, private local secret autoload, authenticated on-demand Elliott screenshot/PDF bridge."

input group "WEBSITE • FXGA Elliott PDF Report Bridge"
input bool   InpWebsiteReportBridge=true;
input string InpWebsiteReportApiBase="https://fxga-macro-dashboard-kbjj66blka-uc.a.run.app"; // Production FXGA Cloud Run API.
input string InpWebsiteReportSecret=""; // Optional private override. Leave blank to auto-load the local secret file.
input bool   InpWebsiteReportAutoLoadSecretFile=true;
input string InpWebsiteReportSecretFile="Elliot Wave Indicator Report\\EA_Bridge.secret"; // Relative to MQL5\Files.
input string InpWebsiteReportTerminalId="FXGA-MT5-PRIMARY";
input int    InpWebsiteReportPollSeconds=3;
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
string   gWebSecret="";
bool     gWebSecretFromFile=false;
bool     gWebAuthConfirmed=false;
int      gWebLastHttpStatus=0;

bool WebConfigValidate()
  {
   gWebConfigIssue="";
   if(!InpWebsiteReportBridge)
     {
      gWebConfigIssue="bridge disabled by input";
      return false;
     }

   gWebApiBase=WebNormalizeBase(InpWebsiteReportApiBase);
   WebLoadSecret();

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
   if(gWebSecret=="")
     {
      gWebConfigIssue="bridge secret missing; create MQL5\\Files\\"+InpWebsiteReportSecretFile+" or set InpWebsiteReportSecret";
      return false;
     }
   if(StringLen(gWebSecret)<16)
     {
      gWebConfigIssue="bridge secret is too short; it must match FXGA_MT5_REPORT_SECRET";
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
   Print("EA Bridge v13.22 | CONFIGURATION REQUIRED | ",gWebConfigIssue);
   Print("EA Bridge | Production API is already configured: ",InpWebsiteReportApiBase);
   Print("EA Bridge | Store FXGA_MT5_REPORT_SECRET privately in MQL5\\Files\\",InpWebsiteReportSecretFile," or use InpWebsiteReportSecret once.");
   Print("EA Bridge | Also add the Cloud Run base URL in MT5: Tools > Options > Expert Advisors > Allow WebRequest for listed URL.");
   Print("EA Bridge | The EA remains loaded and passive. It will not capture or upload screenshots while configuration is incomplete.");
  }

string WebLockKey() { return "FXGA_EW_WEB_REPORT_LOCK"; }
string WebLockHeartbeatKey() { return "FXGA_EW_WEB_REPORT_LOCK_HB"; }
string WebChildKey(const long chart_id) { return "FXGA_EW_REPORT_CHILD_"+IntegerToString(chart_id); }
string WebReadyKey(const long chart_id) { return "FXGA_EW_REPORT_READY_"+IntegerToString(chart_id); }

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

bool WebLoadSecret()
  {
   gWebSecret=WebTrim(InpWebsiteReportSecret);
   gWebSecretFromFile=false;
   if(StringLen(gWebSecret)>=16) return true;
   gWebSecret="";
   if(!InpWebsiteReportAutoLoadSecretFile) return false;

   string candidates[2];
   candidates[0]=WebTrim(InpWebsiteReportSecretFile);
   candidates[1]="EA_Bridge.secret";
   for(int i=0;i<2;i++)
     {
      if(candidates[i]=="") continue;
      ResetLastError();
      int h=FileOpen(candidates[i],FILE_READ|FILE_TXT|FILE_ANSI);
      if(h==INVALID_HANDLE) continue;
      string secret="";
      while(!FileIsEnding(h)) secret+=FileReadString(h);
      FileClose(h);
      secret=WebTrim(secret);
      if(StringLen(secret)>=16)
        {
         gWebSecret=secret;
         gWebSecretFromFile=true;
         if(InpWebsiteReportVerbose)
            Print("EA Bridge v13.22 | private secret loaded from MQL5\\Files\\",candidates[i]);
         return true;
        }
     }
   return false;
  }

string WebJsonEscape(string value)
  {
   StringReplace(value,"\\","\\\\");
   StringReplace(value,"\"","\\\"");
   StringReplace(value,"\r"," ");
   StringReplace(value,"\n"," ");
   return value;
  }

string WebJsonString(const string json,const string key)
  {
   string needle="\""+key+"\":";
   int p=StringFind(json,needle);
   if(p<0) return "";
   p+=StringLen(needle);
   while(p<StringLen(json) && StringSubstr(json,p,1)==" ") p++;
   if(p>=StringLen(json) || StringSubstr(json,p,1)!="\"") return "";
   p++;
   string out="";
   bool escape=false;
   for(int i=p;i<StringLen(json);i++)
     {
      string c=StringSubstr(json,i,1);
      if(escape)
        {
         if(c=="n") out+="\n";
         else if(c=="r") out+="\r";
         else if(c=="t") out+="\t";
         else out+=c;
         escape=false;
         continue;
        }
      if(c=="\\") { escape=true; continue; }
      if(c=="\"") break;
      out+=c;
     }
   return out;
  }

bool WebJsonJobIsNull(const string json)
  {
   return StringFind(json,"\"job\":null")>=0;
  }

ENUM_TIMEFRAMES WebTimeframeFromName(string tf)
  {
   tf=WebTrim(tf);
   StringToUpper(tf);
   if(tf=="M1") return PERIOD_M1;
   if(tf=="M2") return PERIOD_M2;
   if(tf=="M3") return PERIOD_M3;
   if(tf=="M4") return PERIOD_M4;
   if(tf=="M5") return PERIOD_M5;
   if(tf=="M6") return PERIOD_M6;
   if(tf=="M10") return PERIOD_M10;
   if(tf=="M12") return PERIOD_M12;
   if(tf=="M15") return PERIOD_M15;
   if(tf=="M20") return PERIOD_M20;
   if(tf=="M30") return PERIOD_M30;
   if(tf=="H1") return PERIOD_H1;
   if(tf=="H2") return PERIOD_H2;
   if(tf=="H3") return PERIOD_H3;
   if(tf=="H4") return PERIOD_H4;
   if(tf=="H6") return PERIOD_H6;
   if(tf=="H8") return PERIOD_H8;
   if(tf=="H12") return PERIOD_H12;
   if(tf=="D1") return PERIOD_D1;
   if(tf=="W1") return PERIOD_W1;
   if(tf=="MN1") return PERIOD_MN1;
   return PERIOD_CURRENT;
  }

bool WebAcquireWorkerLock()
  {
   if(gWebChildMode) return false;
   string key=WebLockKey(),hbkey=WebLockHeartbeatKey();
   double me=(double)ChartID();
   datetime now=TimeLocal();
   if(!GlobalVariableCheck(key))
     {
      GlobalVariableSet(key,me);
      GlobalVariableSet(hbkey,(double)now);
     }
   double owner=GlobalVariableGet(key);
   if((long)owner==ChartID())
     {
      GlobalVariableSet(hbkey,(double)now);
      gWebOwnLock=true;
      return true;
     }
   datetime heartbeat=0;
   if(GlobalVariableCheck(hbkey)) heartbeat=(datetime)(long)GlobalVariableGet(hbkey);
   if(heartbeat<=0 || now-heartbeat>30)
     {
      GlobalVariableSet(key,me);
      GlobalVariableSet(hbkey,(double)now);
      gWebOwnLock=true;
      if(InpWebsiteReportVerbose) Print("EA Bridge | recovered stale terminal worker lock");
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
      GlobalVariableDel(WebLockHeartbeatKey());
     }
   gWebOwnLock=false;
  }

bool WebHttp(const string method,const string path,const string content_type,
             const char &data[],int &status,string &body)
  {
   body=""; status=-1;
   if(gWebApiBase=="") return false;
   string headers="Accept: application/json\r\nX-FXGA-MT5-Secret: "+gWebSecret+"\r\n";
   if(content_type!="") headers+="Content-Type: "+content_type+"\r\n";
   char result[];
   string response_headers="";
   ResetLastError();
   int timeout=(InpWebsiteReportHttpTimeoutMs<1000 ? 1000 : InpWebsiteReportHttpTimeoutMs);
   status=WebRequest(method,gWebApiBase+path,headers,timeout,data,result,response_headers);
   if(status==-1)
     {
      int err=GetLastError();
      if(InpWebsiteReportVerbose)
        {
         Print("EA Bridge WebRequest failed | err=",err," | ",method," ",gWebApiBase+path);
         if(err==4014) Print("EA Bridge | Add the Cloud Run API URL to MT5 Tools > Options > Expert Advisors > Allow WebRequest for listed URL.");
        }
      return false;
     }
   if(ArraySize(result)>0) body=CharArrayToString(result,0,-1,CP_UTF8);
   return (status>=200 && status<300);
  }

bool WebHttpEmpty(const string method,const string path,int &status,string &body)
  {
   char data[];
   ArrayResize(data,0);
   return WebHttp(method,path,"application/json",data,status,body);
  }

bool WebHttpJson(const string method,const string path,const string json,int &status,string &body)
  {
   char data[];
   int n=StringToCharArray(json,data,0,WHOLE_ARRAY,CP_UTF8);
   if(n>0 && data[n-1]==0) ArrayResize(data,n-1);
   return WebHttp(method,path,"application/json",data,status,body);
  }

bool WebReadBinaryFile(const string file_name,char &bytes[])
  {
   int h=FileOpen(file_name,FILE_READ|FILE_BIN|FILE_SHARE_READ);
   if(h==INVALID_HANDLE) return false;
   long size=FileSize(h);
   if(size<=0 || size>8*1024*1024)
     {
      FileClose(h);
      return false;
     }
   int count=(int)size;
   ArrayResize(bytes,count);
   uint read=FileReadArray(h,bytes,0,count);
   FileClose(h);
   if(read!=(uint)count)
     {
      ArrayResize(bytes,0);
      return false;
     }
   return true;
  }

void WebCloseChildChart()
  {
   if(gWebChildChartId>0)
     {
      GlobalVariableDel(WebReadyKey(gWebChildChartId));
      GlobalVariableDel(WebChildKey(gWebChildChartId));
      ChartClose(gWebChildChartId);
     }
   gWebChildChartId=0;
   gWebChildOpenedMs=0;
   gWebChildOpenedLocal=0;
  }

void WebResetJob()
  {
   WebCloseChildChart();
   if(gWebScreenshotFile!="") FileDelete(gWebScreenshotFile);
   gWebJobId="";
   gWebSymbol="";
   ArrayResize(gWebTimeframes,0);
   gWebTimeframeCount=0;
   gWebTimeframeIndex=0;
   gWebScreenshotFile="";
   gWebRetryCount=0;
   gWebStage=FXGA_WEB_IDLE;
  }

void WebFailJob(const string reason)
  {
   if(gWebJobId!="")
     {
      int status=-1; string body="";
      string json="{\"error\":\""+WebJsonEscape(reason)+"\"}";
      WebHttpJson("POST","/api/elliott-reports/fail?jobId="+gWebJobId+"&terminalId="+InpWebsiteReportTerminalId,json,status,body);
     }
   Print("EA Bridge FAILED | ",reason);
   WebResetJob();
  }

bool WebOpenCurrentTimeframe()
  {
   if(gWebTimeframeIndex<0 || gWebTimeframeIndex>=gWebTimeframeCount) return false;
   string tf_name=gWebTimeframes[gWebTimeframeIndex];
   ENUM_TIMEFRAMES tf=WebTimeframeFromName(tf_name);
   if(tf==PERIOD_CURRENT && tf_name!="M1") return false;
   if(!SymbolSelect(gWebSymbol,true)) return false;

   long chart=ChartOpen(gWebSymbol,tf);
   if(chart<=0) return false;
   gWebChildChartId=chart;
   GlobalVariableSet(WebChildKey(chart),1.0); // child bridge EA instances stay passive
   GlobalVariableDel(WebReadyKey(chart));

   if(!ChartApplyTemplate(chart,InpWebsiteReportTemplateName))
     {
      if(InpWebsiteReportVerbose) Print("EA Bridge | ChartApplyTemplate failed for ",tf_name," err=",GetLastError());
      WebCloseChildChart();
      return false;
     }
   gWebChildOpenedMs=GetTickCount64();
   gWebChildOpenedLocal=TimeLocal();
   gWebRetryCount=0;
   gWebStage=FXGA_WEB_WAIT_RENDER;
   if(InpWebsiteReportVerbose) Print("EA Bridge | opened ",gWebSymbol," ",tf_name," (",gWebTimeframeIndex+1,"/",gWebTimeframeCount,")");
   return true;
  }

bool WebCaptureAndUploadCurrent()
  {
   if(gWebChildChartId<=0 || gWebTimeframeIndex>=gWebTimeframeCount) return false;
   string tf_name=gWebTimeframes[gWebTimeframeIndex];
   int job_len=StringLen(gWebJobId);
   int short_len=(job_len<8 ? job_len : 8);
   string short_id=StringSubstr(gWebJobId,0,short_len);
   gWebScreenshotFile="FXGA_Elliott_"+short_id+"_"+tf_name+".png";
   FileDelete(gWebScreenshotFile);
   ChartRedraw(gWebChildChartId);
   Sleep(200);
   ResetLastError();
   int shot_width=(InpWebsiteReportScreenshotWidth<800 ? 800 : InpWebsiteReportScreenshotWidth);
   int shot_height=(InpWebsiteReportScreenshotHeight<450 ? 450 : InpWebsiteReportScreenshotHeight);
   if(!ChartScreenShot(gWebChildChartId,gWebScreenshotFile,shot_width,shot_height,ALIGN_RIGHT))
     {
      if(InpWebsiteReportVerbose) Print("EA Bridge | ChartScreenShot failed ",tf_name," err=",GetLastError());
      return false;
     }
   Sleep(250);

   char png[];
   if(!WebReadBinaryFile(gWebScreenshotFile,png))
     {
      if(InpWebsiteReportVerbose) Print("EA Bridge | screenshot file not ready/readable ",gWebScreenshotFile);
      return false;
     }

   int status=-1; string body="";
   string path="/api/elliott-reports/upload?jobId="+gWebJobId+"&timeframe="+tf_name+"&terminalId="+InpWebsiteReportTerminalId;
   bool ok=WebHttp("POST",path,"image/png",png,status,body);
   if(!ok)
     {
      if(InpWebsiteReportVerbose) Print("EA Bridge | upload failed ",tf_name," HTTP=",status," body=",body);
      return false;
     }
   FileDelete(gWebScreenshotFile);
   gWebScreenshotFile="";
   if(InpWebsiteReportVerbose) Print("EA Bridge | uploaded ",tf_name," HTTP=",status);
   return true;
  }

bool WebPrepareJob(const string body)
  {
   string id=WebJsonString(body,"id");
   string symbol=WebJsonString(body,"symbol");
   string csv=WebJsonString(body,"timeframes_csv");
   if(id=="" || symbol=="" || csv=="") return false;

   string parts[];
   ushort sep=StringGetCharacter(",",0);
   int count=StringSplit(csv,sep,parts);
   if(count<=0) return false;

   ArrayResize(gWebTimeframes,count);
   gWebTimeframeCount=0;
   for(int i=0;i<count;i++)
     {
      string tf=WebTrim(parts[i]);
      StringToUpper(tf);
      if(tf=="") continue;
      ENUM_TIMEFRAMES mapped=WebTimeframeFromName(tf);
      if(mapped==PERIOD_CURRENT && tf!="M1") continue;
      gWebTimeframes[gWebTimeframeCount++]=tf;
     }
   ArrayResize(gWebTimeframes,gWebTimeframeCount);
   if(gWebTimeframeCount<=0) return false;

   gWebJobId=id;
   gWebSymbol=symbol;
   gWebTimeframeIndex=0;
   gWebRetryCount=0;

   // Save the exact chart/indicator configuration only after an Analyze job exists.
   // This keeps screenshot activity and report-specific template work fully on-demand.
   if(!ChartSaveTemplate(ChartID(),InpWebsiteReportTemplateName))
     {
      Print("EA Bridge | could not save capture template ",InpWebsiteReportTemplateName," err=",GetLastError());
      return false;
     }
   return WebOpenCurrentTimeframe();
  }

void WebPollForJob()
  {
   if(gWebJobId!="") return;
   ulong now=GetTickCount64();
   int poll_seconds=(InpWebsiteReportPollSeconds<1 ? 1 : InpWebsiteReportPollSeconds);
   if(gWebLastPollMs>0 && now-gWebLastPollMs<(ulong)poll_seconds*1000) return;
   gWebLastPollMs=now;
   int status=-1; string body="";
   bool ok=WebHttpEmpty("GET","/api/elliott-reports/jobs/next?terminalId="+InpWebsiteReportTerminalId,status,body);
   gWebLastHttpStatus=status;
   if(!ok)
     {
      gWebAuthConfirmed=false;
      if(status==401)
         Print("EA Bridge AUTH FAILED | HTTP 401 | local secret does not match FXGA_MT5_REPORT_SECRET");
      else if(status==-1)
         Print("EA Bridge CONNECTION FAILED | add ",gWebApiBase," to MT5 Tools > Options > Expert Advisors > Allow WebRequest for listed URL");
      else if(InpWebsiteReportVerbose)
         Print("EA Bridge | poll HTTP=",status," body=",body);
      return;
     }
   if(!gWebAuthConfirmed)
     {
      gWebAuthConfirmed=true;
      Print("EA Bridge CONNECTED + AUTHENTICATED | terminal=",InpWebsiteReportTerminalId,
            " | API=",gWebApiBase,
            " | secret_source=",(gWebSecretFromFile ? "private-file" : "input-override"));
     }
   if(WebJsonJobIsNull(body)) return; // IMPORTANT: no screenshots are taken while the website queue is empty.
   if(!WebPrepareJob(body)) WebFailJob("Invalid job payload or unable to prepare capture template");
  }

void WebProcessRenderWait()
  {
   if(gWebChildChartId<=0) { WebFailJob("Temporary report chart was lost"); return; }
   ulong elapsed=GetTickCount64()-gWebChildOpenedMs;
   bool ready=false;
   string ready_key=WebReadyKey(gWebChildChartId);
   if(GlobalVariableCheck(ready_key))
     {
      datetime published=(datetime)(long)GlobalVariableGet(ready_key);
      ready=(published>=gWebChildOpenedLocal);
     }
   int load_seconds=(InpWebsiteReportChartLoadSeconds<2 ? 2 : InpWebsiteReportChartLoadSeconds);
   bool fallback=(elapsed>=(ulong)load_seconds*1000);
   if(!ready && !fallback) return;

   if(!WebCaptureAndUploadCurrent())
     {
      gWebRetryCount++;
      int max_retries=(InpWebsiteReportMaxRetries<1 ? 1 : InpWebsiteReportMaxRetries);
      if(gWebRetryCount>=max_retries)
        {
         WebFailJob("Screenshot/upload failed for "+gWebTimeframes[gWebTimeframeIndex]+" after retries");
         return;
        }
      return;
     }

   WebCloseChildChart();
   gWebTimeframeIndex++;
   gWebRetryCount=0;
   if(gWebTimeframeIndex>=gWebTimeframeCount)
     {
      gWebStage=FXGA_WEB_COMPLETE;
      gWebLastCompleteAttemptMs=0;
      return;
     }
   if(!WebOpenCurrentTimeframe()) WebFailJob("Unable to open/apply Elliott template for "+gWebTimeframes[gWebTimeframeIndex]);
  }

void WebCompleteJob()
  {
   ulong now=GetTickCount64();
   if(gWebLastCompleteAttemptMs>0 && now-gWebLastCompleteAttemptMs<3000) return;
   gWebLastCompleteAttemptMs=now;
   int status=-1; string body="";
   bool ok=WebHttpEmpty("POST","/api/elliott-reports/complete?jobId="+gWebJobId+"&terminalId="+InpWebsiteReportTerminalId,status,body);
   if(ok && status==200)
     {
      Print("EA Bridge READY | job=",gWebJobId," | ",gWebSymbol," | pages=",gWebTimeframeCount);
      WebResetJob();
      return;
     }
   if(status==202) return; // backend is still assembling the PDF; retry until READY/200
   gWebRetryCount++;
   if(InpWebsiteReportVerbose) Print("EA Bridge | PDF finalize retry ",gWebRetryCount," HTTP=",status," body=",body);
   int max_retries=(InpWebsiteReportMaxRetries<1 ? 1 : InpWebsiteReportMaxRetries);
   if(gWebRetryCount>=max_retries) WebFailJob("Server could not finalize the PDF report");
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
         Print("EA Bridge v13.22 | child capture chart passive | chart=",ChartID());
      return INIT_SUCCEEDED;
     }

   EventSetTimer(1);

   if(!InpWebsiteReportBridge)
     {
      gWebConfigReady=false;
      gWebConfigIssue="bridge disabled by input";
      Print("EA Bridge v13.22 | loaded successfully | bridge disabled");
      return INIT_SUCCEEDED;
     }

   gWebConfigReady=WebConfigValidate();

   if(!gWebConfigReady)
     {
      // v13.22: keep the EA attached instead of failing initialization.
      // Staying attached makes configuration failures visible and prevents
      // MT5 from immediately removing the EA from the chart.
      WebPrintConfigurationGuide();
      return INIT_SUCCEEDED;
     }

   WebAcquireWorkerLock();
   Print("EA Bridge v13.22 | READY | terminal=",InpWebsiteReportTerminalId,
         " | API=",gWebApiBase,
         " | secret_source=",(gWebSecretFromFile ? "private-file" : "input-override"),
         " | screenshots occur ONLY after a website Analyze job");
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   if(!gWebChildMode) EventKillTimer();
   WebCloseChildChart();
   if(gWebScreenshotFile!="") FileDelete(gWebScreenshotFile);
   WebReleaseWorkerLock();
  }

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
