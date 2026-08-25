#property strict
#property version   "1.00"
#property description "Publishes the terminal's real broker symbol inventory to the FXGA Google Cloud MT5 scanner endpoint."

input string InpEndpoint = "https://fxga-mt5-signal-ingress-kbjj66blka-uc.a.run.app/api/mt5/scanner-universe";
input string InpMT5Token = "";
input int    InpPublishEverySeconds = 30;
input int    InpHttpTimeoutMs = 15000;
input bool   InpScannerIncludesAllBrokerSymbols = true;
input bool   InpPublishOnInit = true;

string FXGA_SCHEMA = "fxga.mt5.scanner-universe.v1";
string FXGA_STREAM = "fxga_smc2000_mt5_multi_asset";
string FXGA_ENGINE = "FXGA_SMC2000";

string JsonEscape(const string value)
{
   string out = "";
   const int n = StringLen(value);
   for(int i = 0; i < n; i++)
   {
      const ushort c = (ushort)StringGetCharacter(value, i);
      if(c == 34)       out += "\\\"";
      else if(c == 92)  out += "\\\\";
      else if(c == 8)   out += "\\b";
      else if(c == 9)   out += "\\t";
      else if(c == 10)  out += "\\n";
      else if(c == 12)  out += "\\f";
      else if(c == 13)  out += "\\r";
      else if(c < 32)   out += StringFormat("\\u%04X", (int)c);
      else              out += StringSubstr(value, i, 1);
   }
   return out;
}

string JsonString(const string value)
{
   return "\"" + JsonEscape(value) + "\"";
}

long EpochMilliseconds()
{
   return ((long)TimeCurrent()) * 1000;
}

bool ScannerIncluded(const string symbol)
{
   if(InpScannerIncludesAllBrokerSymbols)
      return true;
   return (bool)SymbolInfoInteger(symbol, SYMBOL_SELECT);
}

string SymbolJson(const string symbol)
{
   const string description = SymbolInfoString(symbol, SYMBOL_DESCRIPTION);
   const string path = SymbolInfoString(symbol, SYMBOL_PATH);
   const string baseCurrency = SymbolInfoString(symbol, SYMBOL_CURRENCY_BASE);
   const string profitCurrency = SymbolInfoString(symbol, SYMBOL_CURRENCY_PROFIT);
   const string marginCurrency = SymbolInfoString(symbol, SYMBOL_CURRENCY_MARGIN);
   const long tradeMode = SymbolInfoInteger(symbol, SYMBOL_TRADE_MODE);
   const long digits = SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   const bool selected = ScannerIncluded(symbol);
   const string status = (tradeMode == SYMBOL_TRADE_MODE_DISABLED ? "DISABLED" : "AVAILABLE");

   string row = "{";
   row += "\"symbol\":" + JsonString(symbol) + ",";
   row += "\"description\":" + JsonString(description) + ",";
   row += "\"path\":" + JsonString(path) + ",";
   row += "\"base_currency\":" + JsonString(baseCurrency) + ",";
   row += "\"profit_currency\":" + JsonString(profitCurrency) + ",";
   row += "\"margin_currency\":" + JsonString(marginCurrency) + ",";
   row += "\"trade_mode\":" + IntegerToString(tradeMode) + ",";
   row += "\"digits\":" + IntegerToString(digits) + ",";
   row += "\"scanner_included\":" + string(selected ? "true" : "false") + ",";
   row += "\"status\":" + JsonString(status) + ",";
   row += "\"last_scan_ms\":0,";
   row += "\"scans\":0,";
   row += "\"published\":0";
   row += "}";
   return row;
}

bool BuildPayload(string &payload, int &terminalTotal, int &scannerTotal)
{
   terminalTotal = SymbolsTotal(false);
   scannerTotal = 0;
   if(terminalTotal <= 0)
   {
      Print("FXGA universe publisher: terminal returned no broker symbols.");
      return false;
   }

   string rows = "";
   int emitted = 0;
   for(int i = 0; i < terminalTotal; i++)
   {
      const string symbol = SymbolName(i, false);
      if(symbol == "")
         continue;

      const bool included = ScannerIncluded(symbol);
      if(included)
         scannerTotal++;

      if(emitted > 0)
         rows += ",";
      rows += SymbolJson(symbol);
      emitted++;
   }

   payload = "{";
   payload += "\"schema\":" + JsonString(FXGA_SCHEMA) + ",";
   payload += "\"source\":\"MetaTrader5\",";
   payload += "\"engine\":" + JsonString(FXGA_ENGINE) + ",";
   payload += "\"stream\":" + JsonString(FXGA_STREAM) + ",";
   payload += "\"generated_at_ms\":" + LongToString(EpochMilliseconds()) + ",";
   payload += "\"total_symbols\":" + IntegerToString(terminalTotal) + ",";
   payload += "\"scan_symbols\":" + IntegerToString(scannerTotal) + ",";
   payload += "\"broker\":{";
   payload += "\"company\":" + JsonString(AccountInfoString(ACCOUNT_COMPANY)) + ",";
   payload += "\"server\":" + JsonString(AccountInfoString(ACCOUNT_SERVER));
   payload += "},";
   payload += "\"symbols\":[" + rows + "]";
   payload += "}";
   return true;
}

bool PublishUniverse()
{
   if(StringLen(InpMT5Token) < 16)
   {
      Print("FXGA universe publisher: InpMT5Token is empty. Use the same plain MT5 token configured for the FXGA webhook publisher.");
      return false;
   }

   string payload;
   int terminalTotal = 0;
   int scannerTotal = 0;
   if(!BuildPayload(payload, terminalTotal, scannerTotal))
      return false;

   char body[];
   StringToCharArray(payload, body, 0, WHOLE_ARRAY, CP_UTF8);
   if(ArraySize(body) > 0 && body[ArraySize(body) - 1] == 0)
      ArrayResize(body, ArraySize(body) - 1);

   char result[];
   string responseHeaders = "";
   string headers = "Content-Type: application/json\r\n";
   headers += "Accept: application/json\r\n";
   headers += "X-FXGA-MT5-Token: " + InpMT5Token + "\r\n";

   ResetLastError();
   const int status = WebRequest("POST", InpEndpoint, headers, InpHttpTimeoutMs, body, result, responseHeaders);
   const int error = GetLastError();
   const string response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);

   if(status == -1)
   {
      PrintFormat("FXGA universe publisher WebRequest failed. MT5 error=%d. Add the Cloud Run origin to Tools > Options > Expert Advisors > Allow WebRequest for listed URL.", error);
      return false;
   }
   if(status < 200 || status >= 300)
   {
      PrintFormat("FXGA universe publisher rejected. HTTP=%d response=%s", status, response);
      return false;
   }

   PrintFormat("FXGA broker universe published. terminal=%d scanner=%d HTTP=%d", terminalTotal, scannerTotal, status);
   Comment("FXGA Broker Universe Publisher\n",
           "LIVE · HTTP ", status, "\n",
           "Broker symbols: ", terminalTotal, "\n",
           "Scanner symbols: ", scannerTotal, "\n",
           "Refresh: ", MathMax(10, InpPublishEverySeconds), " sec");
   return true;
}

int OnInit()
{
   const int seconds = MathMax(10, InpPublishEverySeconds);
   EventSetTimer(seconds);
   if(InpPublishOnInit)
      PublishUniverse();
   return INIT_SUCCEEDED;
}

void OnTimer()
{
   PublishUniverse();
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
}
