from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, content):
    (ROOT / path).write_text(content, encoding='utf-8')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Patch anchor not found: {label}')
    return text.replace(old, new, 1)

engine_path='cloud-run-collector/src/technical-engine.js'
engine=read(engine_path)
engine=replace_once(
    engine,
    "const MINUTE = 60_000;",
    "import { buildAdvancedTimeframeContext, buildNestedContext, buildSmtContext } from './advanced-technical.js';\n\nconst MINUTE = 60_000;",
    'advanced import',
)
engine=replace_once(
    engine,
    "for (const timeframe of Object.keys(TECHNICAL_TIMEFRAMES)) timeframes[timeframe] = analyzeTimeframe(timeframe,state.bars?.[timeframe] || []);",
    "for (const timeframe of Object.keys(TECHNICAL_TIMEFRAMES)) {\n      const analyzed=analyzeTimeframe(timeframe,state.bars?.[timeframe] || []);\n      analyzed.advanced=buildAdvancedTimeframeContext(analyzed.history,analyzed);\n      timeframes[timeframe]=analyzed;\n    }",
    'advanced timeframe enrichment',
)
engine=replace_once(
    engine,
    "const models = {\n      D1_H1_M5:executionModel('D1 → H1 → M5',timeframes,{direction:'D1',confirmation:'H1',entry:'M5'}),\n      H4_M15_M1:executionModel('H4 → M15 → M1',timeframes,{direction:'H4',confirmation:'M15',entry:'M1'}),\n    };",
    "const models = {\n      D1_H1_M5:executionModel('D1 → H1 → M5',timeframes,{direction:'D1',confirmation:'H1',entry:'M5'}),\n      H4_M15_M1:executionModel('H4 → M15 → M1',timeframes,{direction:'H4',confirmation:'M15',entry:'M1'}),\n    };\n    const nested=buildNestedContext(timeframes);",
    'nested structure context',
)
engine=replace_once(
    engine,
    "timeframes,\n      models,\n      decisionGate:decisionGate(timeframes,models),",
    "timeframes,\n      models,\n      nested,\n      decisionGate:decisionGate(timeframes,models),",
    'nested payload',
)
engine=replace_once(
    engine,
    "const values = Object.values(assets);\n  return {",
    "const values = Object.values(assets);\n  const smt=buildSmtContext(assets);\n  return {",
    'SMT context',
)
engine=replace_once(
    engine,
    "hierarchy:['D1 → H1 → M5','H4 → M15 → M1'],\n    sourcePolicy:",
    "hierarchy:['D1 → H1 → M5','H4 → M15 → M1'],\n    advancedConcepts:['Breaker Block','Inverse FVG','Balanced Price Range','Consequent Encroachment','OTE 62–79 / 70.5','Protected Swing','Liquidity Void','SMT Divergence','Session Context','Nested Order Blocks'],\n    smt,\n    sourcePolicy:",
    'advanced concepts payload',
)
write(engine_path,engine)

package_path='cloud-run-collector/package.json'
package=read(package_path)
package=replace_once(package,"node --check src/technical-engine.js &&","node --check src/technical-engine.js && node --check src/advanced-technical.js &&",'advanced syntax gate')
write(package_path,package)
print('Advanced SMC integration patch applied successfully.')
