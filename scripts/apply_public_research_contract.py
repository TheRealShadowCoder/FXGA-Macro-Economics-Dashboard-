from pathlib import Path

path=Path('worker/index-v3.ts')
text=path.read_text(encoding='utf-8')
old="if(url.pathname==='/api/research')return intel?.research?json(intel.research):error('Research snapshot is not initialized',503);"
new="if(url.pathname==='/api/research')return intel?.research?json({...intel.research,decisionCore:intel.decisionGovernance??null,decisionMemory:intel.decisionMemory??null,intelligenceGeneratedAt:intel.generatedAt??null}):error('Research snapshot is not initialized',503);"
count=text.count(old)
if count!=1:
    raise SystemExit(f'public research endpoint anchor expected once, found {count}')
text=text.replace(old,new,1)
path.write_text(text,encoding='utf-8')
print('Public /api/research now composes research, decision governance, and decision memory.')
