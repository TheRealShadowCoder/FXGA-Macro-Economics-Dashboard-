from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def patch(path, replacements):
    file=ROOT/path
    text=file.read_text(encoding='utf-8')
    for old,new,label in replacements:
        if old not in text: raise SystemExit(f'Patch anchor missing: {label}')
        text=text.replace(old,new,1)
    file.write_text(text,encoding='utf-8')

patch('cloud-run-collector/src/technical-engine.js',[
    ("const HISTORY_BARS = 42;","const HISTORY_BARS = 24;",'compact edge history'),
])
patch('cloud-run-collector/src/server-v2.js',[
    ("  const technical=await updateTechnicalMarket(snapshot).catch((error)=>({error:String(error?.message||error).slice(0,300)}));\n  return { changed:saved.changed, requested:snapshot.requested, live:snapshot.live, staleRetained:snapshot.staleRetained, failed:snapshot.failed, durationMs:snapshot.durationMs, technical };",
     "  const technical=await updateTechnicalMarket(snapshot);\n  return { changed:saved.changed, requested:snapshot.requested, live:snapshot.live, staleRetained:snapshot.staleRetained, failed:snapshot.failed, durationMs:snapshot.durationMs, technical };",
     'surface technical persistence failure'),
])
print('Technical persistence hardening applied successfully.')
