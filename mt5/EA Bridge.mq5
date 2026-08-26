//+------------------------------------------------------------------+
//| EA Bridge v13.40 - FXGA 60-Day Elliott + Macro AI Dossier        |
//| Authenticated, on-demand, non-focus-stealing MT5 worker bridge.   |
//+------------------------------------------------------------------+
#property copyright "FX Global Avengers Trading Academy"
#property version   "13.40"
#property strict
#property description "FXGA EA Bridge v13.40 - background 60-day price history, Elliott evidence and 21-chart dossier capture."

input group "WEBSITE • FXGA 60-Day Elliott AI Dossier"
input bool   InpWebsiteReportBridge=true;
input string InpWebsiteReportApiBase="https://fxga-macro-dashboard-kbjj66blka-uc.a.run.app";
input string InpWebsiteReportSecret=""; // exact FXGA_MT5_REPORT_SECRET
input string InpWebsiteReportTerminalId="FXGA-MT5-PRIMARY";
input int    InpWebsiteReportPollSeconds=3;
input int    InpWebsiteReportHttpTimeoutMs=60000;
input int    InpWebsiteReportChartLoadSeconds=4;
input int    InpWebsiteReportScreenshotWidth=1600;
input int    InpWebsiteReportScreenshotHeight=900;
input int    InpWebsiteReportMaxRetries=3;
input int    InpWebsiteReportHistoryDays=60; // forced to >=60
input string InpWebsiteReportTemplateName="FXGA_Elliott_Web_Report_AUTO.tpl";
input bool   InpWebsiteReportBackgroundCapture=true;
input bool   InpWebsiteReportVerbose=true;

enum ENUM_FXGA_WEB_STAGE { FXGA_WEB_IDLE=0,FXGA_WEB_WAIT_RENDER=1,FXGA_WEB_COMPLETE=2 };
ENUM_FXGA_WEB_STAGE gStage=FXGA_WEB_IDLE;
bool gChildMode=false,gOwnLock=false,gConfigReady=false,gAuthConfirmed=false,gWarned=false;
string gApi="",gSecret="",gJob="",gSymbol="",gTFs[],gShot="",gHistory="";
int gTFCount=0,gTFIndex=0,gRetry=0;
long gParent=0,gWorker=0;
ulong gOpenedMs=0,gLastPollMs=0,gLastCompleteMs=0;
datetime gOpenedLocal=0;

string Trim(string v){StringTrimLeft(v);StringTrimRight(v);return v;}
string Base(string v){v=Trim(v);while(StringLen(v)>0&&StringSubstr(v,StringLen(v)-1,1)=="/")v=StringSubstr(v,0,StringLen(v)-1);return v;}
string Esc(string v){StringReplace(v,"\\","\\\\");StringReplace(v,"\"","\\\"");StringReplace(v,"\r"," ");StringReplace(v,"\n"," ");return v;}
string LockKey(){return "FXGA_EW_WEB_REPORT_LOCK";} string LockHB(){return "FXGA_EW_WEB_REPORT_LOCK_HB";}
string ChildKey(long id){return "FXGA_EW_REPORT_CHILD_"+IntegerToString(id);} string ReadyKey(long id){return "FXGA_EW_REPORT_READY_"+IntegerToString(id);}
string EvidenceFile(long id){return "FXGA_EW_EVIDENCE_"+IntegerToString(id)+".json";} string HistoryFile(){return "FXGA_EW_60D_HISTORY_"+IntegerToString(ChartID())+".csv";}

string JsonString(const string json,const string key)
  {
   string needle="\""+key+"\":"; int p=StringFind(json,needle); if(p<0)return ""; p+=StringLen(needle);
   while(p<StringLen(json)&&StringSubstr(json,p,1)==" ")p++; if(p>=StringLen(json)||StringSubstr(json,p,1)!="\"")return ""; p++;
   string out=""; bool escape=false;
   for(int i=p;i<StringLen(json);i++){string c=StringSubstr(json,i,1);if(escape){if(c=="n")out+="\n";else if(c=="r")out+="\r";else if(c=="t")out+="\t";else out+=c;escape=false;continue;}if(c=="\\"){escape=true;continue;}if(c=="\"")break;out+=c;}
   return out;
  }
bool JobNull(const string json){return StringFind(json,"\"job\":null")>=0;}
ENUM_TIMEFRAMES TF(string s){s=Trim(s);StringToUpper(s);if(s=="M1")return PERIOD_M1;if(s=="M2")return PERIOD_M2;if(s=="M3")return PERIOD_M3;if(s=="M4")return PERIOD_M4;if(s=="M5")return PERIOD_M5;if(s=="M6")return PERIOD_M6;if(s=="M10")return PERIOD_M10;if(s=="M12")return PERIOD_M12;if(s=="M15")return PERIOD_M15;if(s=="M20")return PERIOD_M20;if(s=="M30")return PERIOD_M30;if(s=="H1")return PERIOD_H1;if(s=="H2")return PERIOD_H2;if(s=="H3")return PERIOD_H3;if(s=="H4")return PERIOD_H4;if(s=="H6")return PERIOD_H6;if(s=="H8")return PERIOD_H8;if(s=="H12")return PERIOD_H12;if(s=="D1")return PERIOD_D1;if(s=="W1")return PERIOD_W1;if(s=="MN1")return PERIOD_MN1;return PERIOD_CURRENT;}

bool Config()
  {
   gApi=Base(InpWebsiteReportApiBase);gSecret=Trim(InpWebsiteReportSecret);
   if(!InpWebsiteReportBridge)return false;
   if(gApi==""||(StringFind(gApi,"https://")!=0&&StringFind(gApi,"http://")!=0)){Print("EA Bridge v13.40 | invalid API base");return false;}
   if(StringLen(gSecret)<8){Print("EA Bridge v13.40 | paste exact FXGA_MT5_REPORT_SECRET into InpWebsiteReportSecret");return false;}
   if(InpWebsiteReportPollSeconds<1||InpWebsiteReportHttpTimeoutMs<1000||InpWebsiteReportScreenshotWidth<640||InpWebsiteReportScreenshotHeight<360)return false;
   return true;
  }
void Guide(){if(gWarned)return;gWarned=true;Print("EA Bridge v13.40 | CONFIGURATION REQUIRED | API=",InpWebsiteReportApiBase," | paste FXGA_MT5_REPORT_SECRET into EA Inputs");Print("EA Bridge | Whitelist Cloud Run URL under MT5 Tools > Options > Expert Advisors > Allow WebRequest for listed URL. EA remains safely attached/passive.");}

bool Acquire()
  {
   if(gChildMode)return false;double me=(double)ChartID();datetime now=TimeLocal();
   if(!GlobalVariableCheck(LockKey())){GlobalVariableSet(LockKey(),me);GlobalVariableSet(LockHB(),(double)now);}
   if((long)GlobalVariableGet(LockKey())==ChartID()){GlobalVariableSet(LockHB(),(double)now);gOwnLock=true;return true;}
   datetime hb=GlobalVariableCheck(LockHB())?(datetime)(long)GlobalVariableGet(LockHB()):0;
   if(hb<=0||now-hb>30){GlobalVariableSet(LockKey(),me);GlobalVariableSet(LockHB(),(double)now);gOwnLock=true;return true;}
   gOwnLock=false;return false;
  }
void Release(){if(!gOwnLock)return;if(GlobalVariableCheck(LockKey())&&(long)GlobalVariableGet(LockKey())==ChartID()){GlobalVariableDel(LockKey());GlobalVariableDel(LockHB());}gOwnLock=false;}

bool Http(const string method,const string path,const string contentType,const char &data[],int &status,string &body)
  {
   body="";status=-1;string headers="Accept: application/json\r\nX-FXGA-MT5-Secret: "+gSecret+"\r\n";if(contentType!="")headers+="Content-Type: "+contentType+"\r\n";
   char result[];string responseHeaders="";ResetLastError();int timeout=(InpWebsiteReportHttpTimeoutMs<1000?1000:InpWebsiteReportHttpTimeoutMs);status=WebRequest(method,gApi+path,headers,timeout,data,result,responseHeaders);
   if(status==-1){int err=GetLastError();if(InpWebsiteReportVerbose)Print("EA Bridge WebRequest failed | err=",err," | ",method," ",gApi+path);if(err==4014)Print("EA Bridge | whitelist ",gApi," in MT5 Expert Advisors WebRequest URLs");return false;}
   if(ArraySize(result)>0)body=CharArrayToString(result,0,-1,CP_UTF8);return status>=200&&status<300;
  }
bool HttpEmpty(const string method,const string path,int &status,string &body){char d[];ArrayResize(d,0);return Http(method,path,"application/json",d,status,body);}
bool HttpJson(const string method,const string path,const string json,int &status,string &body){char d[];int n=StringToCharArray(json,d,0,WHOLE_ARRAY,CP_UTF8);if(n>0&&d[n-1]==0)ArrayResize(d,n-1);return Http(method,path,"application/json",d,status,body);}
bool ReadFile(const string name,char &bytes[],long limit){int h=FileOpen(name,FILE_READ|FILE_BIN|FILE_SHARE_READ);if(h==INVALID_HANDLE)return false;long size=FileSize(h);if(size<=0||size>limit){FileClose(h);return false;}ArrayResize(bytes,(int)size);uint n=FileReadArray(h,bytes,0,(int)size);FileClose(h);if(n!=(uint)size){ArrayResize(bytes,0);return false;}return true;}

void BringParent(){if(!InpWebsiteReportBackgroundCapture)return;if(gParent<=0)gParent=ChartID();if(gParent>0){ChartSetInteger(gParent,CHART_BRING_TO_TOP,true);ChartRedraw(gParent);}}
void CloseWorker(){if(gWorker>0){FileDelete(EvidenceFile(gWorker));GlobalVariableDel(ReadyKey(gWorker));GlobalVariableDel(ChildKey(gWorker));ChartClose(gWorker);}gWorker=0;gOpenedMs=0;gOpenedLocal=0;BringParent();}
void ResetJob(){CloseWorker();if(gShot!="")FileDelete(gShot);if(gHistory!="")FileDelete(gHistory);gJob="";gSymbol="";gShot="";gHistory="";ArrayResize(gTFs,0);gTFCount=0;gTFIndex=0;gRetry=0;gStage=FXGA_WEB_IDLE;}
void Fail(const string reason){if(gJob!=""){int st=-1;string body="";HttpJson("POST","/api/elliott-reports/fail?jobId="+gJob+"&terminalId="+InpWebsiteReportTerminalId,"{\"error\":\""+Esc(reason)+"\"}",st,body);}Print("EA Bridge FAILED | ",reason);ResetJob();}

bool WriteHistoryTF(int h,ENUM_TIMEFRAMES tf,string name,int days,long offset)
  {
   datetime to=TimeCurrent(),from=to-(datetime)((days+3)*86400);MqlRates r[];ArraySetAsSeries(r,false);int copied=-1;
   for(int a=0;a<4;a++){copied=CopyRates(gSymbol,tf,from,to,r);if(copied>0)break;Sleep(350);}if(copied<=0){Print("EA Bridge | CopyRates failed ",gSymbol," ",name," err=",GetLastError());return false;}
   datetime current=iTime(gSymbol,tf,0);int written=0;
   for(int i=0;i<copied;i++){if(current>0&&r[i].time>=current)continue;long utc=(long)r[i].time-offset;string line=name+","+TimeToString(r[i].time,TIME_DATE|TIME_MINUTES|TIME_SECONDS)+","+IntegerToString(utc)+","+DoubleToString(r[i].open,_Digits)+","+DoubleToString(r[i].high,_Digits)+","+DoubleToString(r[i].low,_Digits)+","+DoubleToString(r[i].close,_Digits)+","+IntegerToString((long)r[i].tick_volume)+","+IntegerToString((long)r[i].spread)+","+IntegerToString((long)r[i].real_volume)+"\r\n";FileWriteString(h,line);written++;}
   if(InpWebsiteReportVerbose)Print("EA Bridge | history ",name," rows=",written);return written>0;
  }
bool UploadHistory()
  {
   int days=(InpWebsiteReportHistoryDays<60?60:InpWebsiteReportHistoryDays);if(!SymbolSelect(gSymbol,true))return false;gHistory=HistoryFile();FileDelete(gHistory);int h=FileOpen(gHistory,FILE_WRITE|FILE_TXT|FILE_ANSI);if(h==INVALID_HANDLE)return false;long offset=(long)(TimeCurrent()-TimeGMT());
   FileWriteString(h,"#FXGA_HISTORY_SCHEMA,1\r\n#symbol,"+gSymbol+"\r\n#history_days,"+IntegerToString(days)+"\r\n#generated_server_time,"+TimeToString(TimeCurrent(),TIME_DATE|TIME_MINUTES|TIME_SECONDS)+"\r\n#generated_gmt_time,"+TimeToString(TimeGMT(),TIME_DATE|TIME_MINUTES|TIME_SECONDS)+"\r\n#server_gmt_offset_seconds,"+IntegerToString(offset)+"\r\n#causal_policy,CLOSED_BARS_ONLY\r\ntf,time_server,time_utc_epoch,open,high,low,close,tick_volume,spread,real_volume\r\n");
   bool ok=true;ok=WriteHistoryTF(h,PERIOD_M5,"M5",days,offset)&&ok;ok=WriteHistoryTF(h,PERIOD_H1,"H1",days,offset)&&ok;ok=WriteHistoryTF(h,PERIOD_H4,"H4",days,offset)&&ok;ok=WriteHistoryTF(h,PERIOD_D1,"D1",days,offset)&&ok;FileClose(h);if(!ok){FileDelete(gHistory);gHistory="";return false;}
   char data[];if(!ReadFile(gHistory,data,16*1024*1024)){FileDelete(gHistory);gHistory="";return false;}int st=-1;string body="";ok=Http("POST","/api/elliott-reports/history?jobId="+gJob+"&terminalId="+InpWebsiteReportTerminalId,"text/csv",data,st,body);FileDelete(gHistory);gHistory="";if(!ok){Print("EA Bridge | history upload failed HTTP=",st," body=",body);return false;}Print("EA Bridge | 60-day CLOSED-BAR M5/H1/H4/D1 history uploaded");return true;
  }

bool PrepareWorker()
  {
   if(gTFIndex<0||gTFIndex>=gTFCount)return false;string name=gTFs[gTFIndex];ENUM_TIMEFRAMES tf=TF(name);if(tf==PERIOD_CURRENT&&name!="M1")return false;if(!SymbolSelect(gSymbol,true))return false;
   if(gWorker<=0){gWorker=ChartOpen(gSymbol,tf);if(gWorker<=0)return false;GlobalVariableSet(ChildKey(gWorker),1.0);GlobalVariableDel(ReadyKey(gWorker));if(!ChartApplyTemplate(gWorker,InpWebsiteReportTemplateName)){CloseWorker();return false;}}
   else{FileDelete(EvidenceFile(gWorker));GlobalVariableDel(ReadyKey(gWorker));if(!ChartSetSymbolPeriod(gWorker,gSymbol,tf))return false;}
   BringParent();gOpenedMs=GetTickCount64();gOpenedLocal=TimeLocal();gRetry=0;gStage=FXGA_WEB_WAIT_RENDER;if(InpWebsiteReportVerbose)Print("EA Bridge | BACKGROUND worker ",gSymbol," ",name," ",gTFIndex+1,"/",gTFCount," | working chart untouched");return true;
  }
bool CaptureCurrent()
  {
   if(gWorker<=0||gTFIndex>=gTFCount)return false;string name=gTFs[gTFIndex],eFile=EvidenceFile(gWorker);char evidence[];if(!ReadFile(eFile,evidence,8*1024*1024))return false;
   int st=-1;string body="";if(!Http("POST","/api/elliott-ai/evidence?jobId="+gJob+"&timeframe="+name+"&terminalId="+InpWebsiteReportTerminalId,"application/json",evidence,st,body))return false;FileDelete(eFile);
   int shortLen=(StringLen(gJob)<8?StringLen(gJob):8);string shortId=StringSubstr(gJob,0,shortLen);gShot="FXGA_Elliott_"+shortId+"_"+name+".png";FileDelete(gShot);ChartRedraw(gWorker);Sleep(200);int shotW=(InpWebsiteReportScreenshotWidth<800?800:InpWebsiteReportScreenshotWidth),shotH=(InpWebsiteReportScreenshotHeight<450?450:InpWebsiteReportScreenshotHeight);if(!ChartScreenShot(gWorker,gShot,shotW,shotH,ALIGN_RIGHT))return false;Sleep(250);char png[];if(!ReadFile(gShot,png,8*1024*1024))return false;
   st=-1;body="";bool ok=Http("POST","/api/elliott-reports/upload?jobId="+gJob+"&timeframe="+name+"&terminalId="+InpWebsiteReportTerminalId,"image/png",png,st,body);if(ok){FileDelete(gShot);gShot="";if(InpWebsiteReportVerbose)Print("EA Bridge | uploaded screenshot + Elliott evidence ",name);}BringParent();return ok;
  }

bool PrepareJob(const string body)
  {
   string id=JsonString(body,"id"),sym=JsonString(body,"symbol"),csv=JsonString(body,"timeframes_csv");if(id==""||sym==""||csv=="")return false;string parts[];ushort sep=StringGetCharacter(",",0);int n=StringSplit(csv,sep,parts);if(n<=0)return false;ArrayResize(gTFs,n);gTFCount=0;
   for(int i=0;i<n;i++){string t=Trim(parts[i]);StringToUpper(t);if(t=="")continue;ENUM_TIMEFRAMES mapped=TF(t);if(mapped==PERIOD_CURRENT&&t!="M1")continue;gTFs[gTFCount++]=t;}ArrayResize(gTFs,gTFCount);if(gTFCount<=0)return false;
   gJob=id;gSymbol=sym;gTFIndex=0;gRetry=0;gParent=ChartID();if(!ChartSaveTemplate(gParent,InpWebsiteReportTemplateName)){Print("EA Bridge | ChartSaveTemplate failed err=",GetLastError());return false;}if(!UploadHistory())return false;BringParent();return PrepareWorker();
  }
void Poll()
  {
   if(gJob!="")return;ulong now=GetTickCount64();int poll=(InpWebsiteReportPollSeconds<1?1:InpWebsiteReportPollSeconds);if(gLastPollMs>0&&now-gLastPollMs<(ulong)poll*1000)return;gLastPollMs=now;int st=-1;string body="";bool ok=HttpEmpty("GET","/api/elliott-reports/jobs/next?terminalId="+InpWebsiteReportTerminalId,st,body);
   if(!ok){gAuthConfirmed=false;if(st==401)Print("EA Bridge AUTH FAILED | secret mismatch");return;}if(!gAuthConfirmed){gAuthConfirmed=true;Print("EA Bridge v13.40 CONNECTED + AUTHENTICATED | terminal=",InpWebsiteReportTerminalId," | API=",gApi," | background dossier capture ready");}if(JobNull(body))return;if(!PrepareJob(body))Fail("Invalid job or unable to prepare 60-day background dossier capture");
  }
void ProcessWorker()
  {
   if(gWorker<=0){Fail("Background worker chart was lost");return;}ulong elapsed=GetTickCount64()-gOpenedMs;bool ready=false;string k=ReadyKey(gWorker);if(GlobalVariableCheck(k)){datetime published=(datetime)(long)GlobalVariableGet(k);ready=published>=gOpenedLocal;}int load=(InpWebsiteReportChartLoadSeconds<2?2:InpWebsiteReportChartLoadSeconds);bool fallback=elapsed>=(ulong)load*1000;if(!ready&&!fallback)return;
   if(!CaptureCurrent()){gRetry++;int maxRetry=(InpWebsiteReportMaxRetries<1?1:InpWebsiteReportMaxRetries);if(gRetry>=maxRetry)Fail("Evidence/screenshot upload failed for "+gTFs[gTFIndex]);return;}
   gTFIndex++;gRetry=0;if(gTFIndex>=gTFCount){gStage=FXGA_WEB_COMPLETE;gLastCompleteMs=0;return;}if(!PrepareWorker())Fail("Unable to retarget background worker to "+gTFs[gTFIndex]);
  }
void Complete()
  {
   ulong now=GetTickCount64();if(gLastCompleteMs>0&&now-gLastCompleteMs<3000)return;gLastCompleteMs=now;int st=-1;string body="";bool ok=HttpEmpty("POST","/api/elliott-reports/complete?jobId="+gJob+"&terminalId="+InpWebsiteReportTerminalId,st,body);if(ok&&st==200){Print("EA Bridge READY | job=",gJob," | ",gSymbol," | 60-day history + 21 charts + Elliott evidence -> ONE AI dossier PDF");ResetJob();return;}if(st==202)return;gRetry++;if(InpWebsiteReportVerbose)Print("EA Bridge | dossier finalize retry ",gRetry," HTTP=",st," body=",body);int maxRetry=(InpWebsiteReportMaxRetries<1?1:InpWebsiteReportMaxRetries);if(gRetry>=maxRetry)Fail("Server could not finalize 60-day dossier PDF");
  }

int OnInit()
  {
   gParent=ChartID();gApi=Base(InpWebsiteReportApiBase);gChildMode=GlobalVariableCheck(ChildKey(ChartID()));if(gChildMode){if(InpWebsiteReportVerbose)Print("EA Bridge v13.40 | passive worker child | chart=",ChartID());return INIT_SUCCEEDED;}EventSetTimer(1);if(!InpWebsiteReportBridge){Print("EA Bridge v13.40 | loaded, bridge disabled");return INIT_SUCCEEDED;}gConfigReady=Config();if(!gConfigReady){Guide();return INIT_SUCCEEDED;}Acquire();Print("EA Bridge v13.40 | READY | terminal=",InpWebsiteReportTerminalId," | 60-day background capture ONLY after website Analyze");return INIT_SUCCEEDED;
  }
void OnDeinit(const int reason){if(!gChildMode)EventKillTimer();CloseWorker();if(gShot!="")FileDelete(gShot);if(gHistory!="")FileDelete(gHistory);Release();}
void OnTimer(){if(gChildMode||!InpWebsiteReportBridge)return;if(!gConfigReady){Guide();return;}if(!Acquire())return;if(gStage==FXGA_WEB_IDLE){Poll();return;}if(gStage==FXGA_WEB_WAIT_RENDER){ProcessWorker();return;}if(gStage==FXGA_WEB_COMPLETE){Complete();return;}}
