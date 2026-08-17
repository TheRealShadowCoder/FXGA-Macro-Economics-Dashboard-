from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'src/components/TechnicalStructureView.tsx'
text=path.read_text(encoding='utf-8')

def repl(old,new,label):
    global text
    if old not in text: raise SystemExit(f'UI patch anchor missing: {label}')
    text=text.replace(old,new,1)

repl("import { fetchTechnicalSnapshot } from '../lib/api';","import { fetchTechnicalSnapshot } from '../lib/api';\nimport { AdvancedSmcPanel, SmtDivergencePanel } from './AdvancedSmcPanel';",'advanced component import')
repl("      <p className=\"structure-reason\">{state.decisionGate.reason}</p>","      <AdvancedSmcPanel state={state} />\n      <p className=\"structure-reason\">{state.decisionGate.reason}</p>",'asset advanced panel')
repl("    {structureAssets.length ? <section className=\"structure-asset-grid\">{structureAssets.map((state) => <StructureAssetCard key={state.id} state={state} quote={quoteById.get(state.id)} />)}</section> : null}\n\n    <section className=\"panel technical-method\">","    {structureAssets.length ? <section className=\"structure-asset-grid\">{structureAssets.map((state) => <StructureAssetCard key={state.id} state={state} quote={quoteById.get(state.id)} />)}</section> : null}\n    <SmtDivergencePanel technical={technical} />\n\n    <section className=\"panel technical-method\">",'SMT panel')
path.write_text(text,encoding='utf-8')
print('Advanced technical UI integration applied successfully.')
