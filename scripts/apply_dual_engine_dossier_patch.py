from pathlib import Path

BRANCH_NOTE = "FXGA dual-engine Elliott + RSI/BB one-PDF dossier patch"


def replace_once(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"Missing patch anchor: {label}")
    return text.replace(old, new, 1)


# -----------------------------------------------------------------------------
# EA Bridge: Elliott + RSI/BB evidence + 60-day history + background capture
# -----------------------------------------------------------------------------
p = Path("mt5/EA Bridge.mq5")
s = p.read_text(encoding="utf-8")
s = s.replace("13.41", "13.50")
s = s.replace("FXGA 60-Day Elliott + Macro AI Dossier", "FXGA 60-Day Elliott + RSI/BB + Macro AI Dossier")
s = s.replace(
    "strict non-repaint evidence handshake, 60-day history and 21-chart dossier capture.",
    "strict dual-engine non-repaint evidence handshake, 60-day history and 21-chart dossier capture.",
)

input_anchor = "input bool   InpWebsiteReportBackgroundCapture=true;\n"
input_add = (
    "input bool   InpWebsiteReportRequireRSIBBEvidence=true; // Require RSI/BB v2.32 local evidence on every worker timeframe.\n"
    "input int    InpWebsiteReportRSIBBTimeoutSeconds=90; // Hard wait ceiling for secondary confirmation evidence.\n"
)
if "InpWebsiteReportRequireRSIBBEvidence" not in s:
    s = replace_once(s, input_anchor, input_anchor + input_add, "EA RSI/BB inputs")

helper_anchor = 'string EvidenceFile(const long id)  { return "FXGA_EW_AI_EVIDENCE_"+IntegerToString(id)+".json"; }\n'
helper_add = (
    'string RSIEvidenceReadyKey(const long id){ return "FXGA_RSI_BB_AI_EVIDENCE_READY_"+IntegerToString(id); }\n'
    'string RSIEvidenceFile(const long id) { return "FXGA_RSI_BB_AI_EVIDENCE_"+IntegerToString(id)+".json"; }\n'
)
if "RSIEvidenceReadyKey" not in s:
    s = replace_once(s, helper_anchor, helper_anchor + helper_add, "EA RSI/BB IPC helpers")

clear_anchor = "   GlobalVariableDel(EvidenceReadyKey(id));\n"
if "GlobalVariableDel(RSIEvidenceReadyKey(id));" not in s:
    s = replace_once(
        s,
        clear_anchor,
        clear_anchor + "   GlobalVariableDel(RSIEvidenceReadyKey(id));\n   FileDelete(RSIEvidenceFile(id));\n",
        "EA clear RSI handshake",
    )

capture_start = s.index("bool CaptureCurrent()")
capture_end = s.index("\nbool PrepareJob(", capture_start)
capture = r'''bool CaptureCurrent()
  {
   if(gWorker<=0 || gTFIndex>=gTFCount) return false;
   string name=gTFs[gTFIndex];
   string eFile=EvidenceFile(gWorker),rFile=RSIEvidenceFile(gWorker);
   char evidenceBytes[],rsiBytes[];
   if(!ReadFile(eFile,evidenceBytes,8*1024*1024))
     {
      if(InpWebsiteReportVerbose) Print("EA Bridge | Elliott evidence not readable yet | ",eFile);
      return false;
     }
   if(InpWebsiteReportRequireRSIBBEvidence && !ReadFile(rFile,rsiBytes,8*1024*1024))
     {
      if(InpWebsiteReportVerbose) Print("EA Bridge | RSI/BB evidence not readable yet | ",rFile);
      return false;
     }

   string elliott=CharArrayToString(evidenceBytes,0,-1,CP_UTF8);
   string combined=elliott;
   if(InpWebsiteReportRequireRSIBBEvidence)
     {
      string rsi=CharArrayToString(rsiBytes,0,-1,CP_UTF8);
      StringTrimLeft(elliott); StringTrimRight(elliott);
      StringTrimLeft(rsi); StringTrimRight(rsi);
      int n=StringLen(elliott);
      if(n<2 || StringSubstr(elliott,n-1,1)!="}" || StringLen(rsi)<2 || StringSubstr(rsi,0,1)!="{" || StringSubstr(rsi,StringLen(rsi)-1,1)!="}") return false;
      combined=StringSubstr(elliott,0,n-1)+",\"rsi_bb_confirmation\":{\"schema_version\":\"FXGA_RSI_BB_AI_EVIDENCE_1\",\"role\":\"SECONDARY_CONFIRMATION_FILTER_ONLY\",\"evidence\":"+rsi+"}}";
     }

   int st=-1; string body="";
   if(!HttpJson("POST","/api/elliott-ai/evidence?jobId="+gJob+"&timeframe="+name+"&terminalId="+InpWebsiteReportTerminalId,combined,st,body))
     {
      if(InpWebsiteReportVerbose) Print("EA Bridge | dual-engine evidence upload failed | ",name," HTTP=",st," body=",body);
      return false;
     }

   int shortLen=(StringLen(gJob)<8 ? StringLen(gJob) : 8);
   string shortId=StringSubstr(gJob,0,shortLen);
   gShot="FXGA_Elliott_"+shortId+"_"+name+".png";
   FileDelete(gShot);
   ChartRedraw(gWorker);
   Sleep(200);
   int shotW=(InpWebsiteReportScreenshotWidth<800 ? 800 : InpWebsiteReportScreenshotWidth);
   int shotH=(InpWebsiteReportScreenshotHeight<450 ? 450 : InpWebsiteReportScreenshotHeight);
   if(!ChartScreenShot(gWorker,gShot,shotW,shotH,ALIGN_RIGHT)) return false;
   Sleep(250);
   char png[];
   if(!ReadFile(gShot,png,8*1024*1024)) return false;

   st=-1; body="";
   bool ok=Http("POST","/api/elliott-reports/upload?jobId="+gJob+"&timeframe="+name+"&terminalId="+InpWebsiteReportTerminalId,
                "image/png",png,st,body);
   if(ok)
     {
      FileDelete(gShot); gShot="";
      FileDelete(eFile);
      if(InpWebsiteReportRequireRSIBBEvidence) FileDelete(rFile);
      if(InpWebsiteReportVerbose) Print("EA Bridge | uploaded Elliott + RSI/BB evidence + screenshot ",name);
     }
   else if(InpWebsiteReportVerbose)
      Print("EA Bridge | screenshot upload failed | ",name," HTTP=",st," body=",body);
   BringParent();
   return ok;
  }
'''
s = s[:capture_start] + capture + s[capture_end:]

worker_start = s.index("void ProcessWorker()")
worker_end = s.index("\nvoid Complete()", worker_start)
worker = r'''void ProcessWorker()
  {
   if(gWorker<=0)
     {
      Fail("Background worker chart was lost");
      return;
     }

   ulong elapsed=GetTickCount64()-gOpenedMs;
   int hardTimeout=(InpWebsiteReportRenderTimeoutSeconds<10 ? 10 : InpWebsiteReportRenderTimeoutSeconds);
   if(InpWebsiteReportRequireRSIBBEvidence && InpWebsiteReportRSIBBTimeoutSeconds>hardTimeout)
      hardTimeout=InpWebsiteReportRSIBBTimeoutSeconds;
   if(elapsed>=(ulong)hardTimeout*1000)
     {
      Fail("Timed out waiting for strict Elliott + RSI/BB evidence on "+gTFs[gTFIndex]+". Capture template must contain Elliott v13.30+ and RSI/BB v2.32+.");
      return;
     }

   bool renderReady=false,elliottReady=false,rsiReady=!InpWebsiteReportRequireRSIBBEvidence;
   if(GlobalVariableCheck(ReadyKey(gWorker)))
     {
      datetime published=(datetime)(long)GlobalVariableGet(ReadyKey(gWorker));
      renderReady=(published>=gOpenedLocal);
     }
   if(GlobalVariableCheck(EvidenceReadyKey(gWorker)))
     {
      datetime published=(datetime)(long)GlobalVariableGet(EvidenceReadyKey(gWorker));
      elliottReady=(published>=gOpenedLocal && FileExistsReadable(EvidenceFile(gWorker)));
     }
   if(InpWebsiteReportRequireRSIBBEvidence && GlobalVariableCheck(RSIEvidenceReadyKey(gWorker)))
     {
      datetime published=(datetime)(long)GlobalVariableGet(RSIEvidenceReadyKey(gWorker));
      rsiReady=(published>=gOpenedLocal && FileExistsReadable(RSIEvidenceFile(gWorker)));
     }
   if(!(renderReady && elliottReady && rsiReady)) return;

   if(!CaptureCurrent())
     {
      gRetry++;
      int maxRetry=(InpWebsiteReportMaxRetries<1 ? 1 : InpWebsiteReportMaxRetries);
      if(gRetry>=maxRetry) Fail("Dual-engine evidence/screenshot upload failed for "+gTFs[gTFIndex]);
      return;
     }

   gTFIndex++;
   gRetry=0;
   if(gTFIndex>=gTFCount)
     {
      gStage=FXGA_WEB_COMPLETE;
      gLastCompleteMs=0;
      return;
     }
   if(!PrepareWorker()) Fail("Unable to retarget background worker to "+gTFs[gTFIndex]);
  }
'''
s = s[:worker_start] + worker + s[worker_end:]
s = s.replace(
    "60-day history + 21 charts + strict Elliott evidence -> ONE AI dossier PDF",
    "60-day history + 21 charts + strict Elliott + RSI/BB evidence -> ONE AI dossier PDF",
)
p.write_text(s, encoding="utf-8")


# -----------------------------------------------------------------------------
# PDF report service: embed RSI/BB evidence in the one canonical PDF
# -----------------------------------------------------------------------------
p = Path("google-cloud-app/elliott-reports.js")
s = p.read_text(encoding="utf-8")
s = s.replace("const DOSSIER_VERSION='FXGA_60D_AI_DOSSIER_2';", "const DOSSIER_VERSION='FXGA_60D_AI_DOSSIER_3_DUAL_ENGINE';", 1)

helper = r'''function rsiBbEvidenceLines(raw){
  const pack=raw?.rsi_bb_confirmation?.evidence||raw?.rsi_bb_confirmation||null;
  if(!pack)return['RSI/BB SECONDARY CONFIRMATION | MISSING - AI must not infer it from Elliott state.'];
  const st=pack.strict_non_repaint||{},c=pack.confirmed_state||{},pv=pack.preview_state||{},l=pack.evidence_ledger||{},rs=pack.research_state||{},gov=pack.ai_governance||{};
  const lines=[
    `RSI/BB ROLE | ${pack.role||raw?.rsi_bb_confirmation?.role||'SECONDARY_CONFIRMATION_FILTER_ONLY'} | may veto/downgrade execution timing; NEVER overrides Elliott hard invalidation`,
    `RSI/BB NON-REPAINT | closed_bar_signals=${boolText(st.closed_bar_signals)} bar0_projection_only=${boolText(st.bar0_projection_only)} append_only=${boolText(st.append_only_evidence)} side_rewrite_forbidden=${boolText(st.historical_side_rewrite_forbidden)} lookahead_forbidden=${boolText(st.future_lookahead_forbidden)} physical_viewport_only=${boolText(st.physical_viewport_only)} forward_right_edge_only=${boolText(st.forward_right_edge_only)}`,
    `RSI/BB CONFIRMED | time=${c.time||'—'} signal=${c.signal_name||'NONE'} zone=${c.zone_name||'NEUTRAL'} RSI=${fmt(c.rsi,3)} upper=${fmt(c.upper,3)} middle=${fmt(c.middle,3)} lower=${fmt(c.lower,3)} width=${fmt(c.band_width,3)} compression=${fmt(c.compression,4)}`,
    `RSI/BB GEOMETRY | slopeU=${fmt(c.slope_upper,4)} slopeM=${fmt(c.slope_middle,4)} slopeL=${fmt(c.slope_lower,4)} squeeze=${boolText(c.is_squeeze)} micro_squeeze=${boolText(c.is_micro_squeeze)}`,
    `RSI/BB PREVIEW ONLY | time=${pv.time||'—'} signal=${pv.signal_name||'NONE'} zone=${pv.zone_name||'NEUTRAL'} RSI=${fmt(pv.rsi,3)} upper=${fmt(pv.upper,3)} middle=${fmt(pv.middle,3)} lower=${fmt(pv.lower,3)} - never treat as confirmed`,
    `RSI/BB EVIDENCE LEDGER | persistent=${l.persistent_count??0} frozen_built=${boolText(l.frozen_built)} last=${l.last_confirmed?.signal_name||'NONE'} @ ${l.last_confirmed?.time||'—'} price=${fmt(l.last_confirmed?.arrow_price)}`,
    `RSI/BB RESEARCH | enabled=${boolText(rs.enabled)} dirty=${boolText(rs.dirty)} events=${rs.events??0} episodes=${rs.episodes??0} journeys=${rs.journeys??0} repeat_clusters=${rs.repeat_clusters??0} geometry_groups=${rs.geometry_groups??0} geometry_families=${rs.geometry_families??0} winner_prototypes=${rs.winner_prototypes??0} causal_decisions=${rs.causal_decisions??0}`,
    `RSI/BB GOVERNANCE | winner_first=${boolText(gov.winner_first_target_class)} loser_control=${boolText(gov.losers_are_control_class)} no_trade_engine=${boolText(gov.no_trade_engine_required)} OOS_required_for_profit_claim=${boolText(gov.profitability_claim_requires_measured_oos_evidence)}`
  ];
  const recent=Array.isArray(l.recent)?l.recent.slice(-24):[];
  for(const e of recent)lines.push(`RSI/BB RECENT EVIDENCE | ${e.time||'—'} ${e.signal_name||e.signal||'—'} price=${fmt(e.arrow_price)} U/M/L=${fmt(e.upper,2)}/${fmt(e.middle,2)}/${fmt(e.lower,2)} scale=${fmt(e.scale_min,2)}-${fmt(e.scale_max,2)}`);
  return lines;
}
'''
if "function rsiBbEvidenceLines" not in s:
    anchor = "function evidenceSummaryLines(row)"
    if anchor not in s:
        raise RuntimeError("Missing report evidence summary anchor")
    s = s.replace(anchor, helper + "\n" + anchor, 1)

summary_start = s.index("function evidenceSummaryLines(row)")
summary_end = s.index("\n\nfunction chooseExecutiveEvidence", summary_start)
block = s[summary_start:summary_end]
if "...rsiBbEvidenceLines(c.raw)" not in block:
    pos = block.rfind("\n];}")
    if pos < 0:
        raise RuntimeError("Missing evidenceSummaryLines end")
    block = block[:pos].rstrip() + ",\n...rsiBbEvidenceLines(c.raw)\n];}"
    s = s[:summary_start] + block + s[summary_end:]

s = s.replace(
    "'5. The numerical 60-day price series and derived event reactions.','6. Actual persisted economic-event chronology and macro evidence.','7. The 21 MT5 screenshots for visual confirmation of labels, nesting and context.','8. Live/developing forecasts, which may never override confirmed evidence.'",
    "'5. Confirmed RSI/Bollinger secondary confirmation: timing/filter evidence only; it may veto or downgrade an entry but can NEVER legalize a hard-invalid Elliott count.','6. The numerical 60-day price series and derived event reactions.','7. Actual persisted economic-event chronology and macro evidence.','8. The 21 MT5 screenshots for visual confirmation of labels, nesting and context.','9. Live/developing forecasts, which may never override confirmed evidence.'",
)
s = s.replace(
    "'- Economic events are catalyst/context evidence only; they cannot legalize an invalid Elliott count.'",
    "'- RSI/Bollinger is an independent execution-quality filter. A strong conflict should downgrade timing or produce WAIT; it can never override Elliott hard structural invalidation.','- Economic events are catalyst/context evidence only; they cannot legalize an invalid Elliott count.'",
)
s = s.replace("60-Day Elliott + Macro AI Dossier", "60-Day Elliott + RSI/BB + Macro AI Dossier")
s = s.replace(
    "60-day closed-bar price series, economic events, strict Elliott evidence and 21 MT5 charts",
    "60-day closed-bar price series, economic events, strict Elliott + RSI/BB evidence and 21 MT5 charts",
)
p.write_text(s, encoding="utf-8")


# -----------------------------------------------------------------------------
# AI service: Gemini reads only PDF and is explicitly governed by dual engines
# -----------------------------------------------------------------------------
p = Path("google-cloud-app/elliott-ai.js")
s = p.read_text(encoding="utf-8")
s = s.replace("const DOSSIER_PREFIX='FXGA_60D_AI_DOSSIER_2';", "const DOSSIER_PREFIX='FXGA_60D_AI_DOSSIER_3';", 1)
s = s.replace("const PROMPT_VERSION='EW-DOSSIER-AI-3';", "const PROMPT_VERSION='EW-DOSSIER-AI-4-DUAL-ENGINE';", 1)
s = s.replace(
    "Follow its embedded evidence hierarchy and strict non-repaint rules.",
    "Follow its embedded evidence hierarchy and strict non-repaint rules. Elliott hard structure remains authoritative. RSI/Bollinger is a secondary confirmation and execution-quality filter: it may veto or downgrade timing, but it may never legalize a hard-invalid Elliott count.",
)
p.write_text(s, encoding="utf-8")


# Static contract assertions. Native MetaEditor compilation is intentionally separate.
ea = Path("mt5/EA Bridge.mq5").read_text(encoding="utf-8")
reports = Path("google-cloud-app/elliott-reports.js").read_text(encoding="utf-8")
ai = Path("google-cloud-app/elliott-ai.js").read_text(encoding="utf-8")
assert "rsi_bb_confirmation" in ea
assert "RSIEvidenceReadyKey" in ea
assert "rsiBbEvidenceLines" in reports
assert "FXGA_60D_AI_DOSSIER_3_DUAL_ENGINE" in reports
assert "EW-DOSSIER-AI-4-DUAL-ENGINE" in ai
print(BRANCH_NOTE + " applied successfully")
