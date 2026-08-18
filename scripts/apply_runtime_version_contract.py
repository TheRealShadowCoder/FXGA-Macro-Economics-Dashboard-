from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one anchor, found {count}')
    return text.replace(old, new, 1)

path = Path('cloud-run-collector/src/super-runtime.js')
text = path.read_text(encoding='utf-8')

if "import { readFileSync } from 'node:fs';" not in text:
    text = replace_once(
        text,
        "import crypto from 'node:crypto';\n",
        "import crypto from 'node:crypto';\nimport { readFileSync } from 'node:fs';\n",
        'fs import'
    )

if 'const SERVICE_VERSION=' not in text:
    anchor = "const fredApiKey=process.env.FRED_API_KEY||'';\n"
    version_code = """const SERVICE_VERSION=(()=>{try{const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));return String(pkg?.version||'0.0.0');}catch{return '0.0.0';}})();
"""
    text = replace_once(text, anchor, anchor + version_code, 'service version constant')

text = replace_once(
    text,
    "return {ok:true,service:'fxga-cloud-run-collector',version:4,architecture:",
    "return {ok:true,service:'fxga-cloud-run-collector',version:SERVICE_VERSION,architecture:",
    'health version field'
)

path.write_text(text, encoding='utf-8')
print('Runtime health version is now sourced from collector package.json.')

path = Path('.github/workflows/verify-intelligence-v414-live.yml')
text = path.read_text(encoding='utf-8')

if "- '.github/run-verify-v414-live.trigger'" not in text:
    text = replace_once(
        text,
        "  workflow_dispatch:\n\npermissions:\n",
        "  workflow_dispatch:\n  push:\n    branches: [main]\n    paths:\n      - '.github/run-verify-v414-live.trigger'\n\npermissions:\n",
        'live verifier push trigger'
    )

text = replace_once(
    text,
    "if: ${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}",
    "if: ${{ github.event_name == 'workflow_dispatch' || github.event_name == 'push' || github.event.workflow_run.conclusion == 'success' }}",
    'live verifier job condition'
)

old_check = """          const h=require('/tmp/health.json');
          if(!h.ok)throw new Error('Production data service is unhealthy');
          if(Number(h.version||0)<4.14)throw new Error(`Expected service >=4.14, got ${h.version}`);
"""
new_check = """          const h=require('/tmp/health.json');
          if(!h.ok)throw new Error('Production data service is unhealthy');
          const parts=String(h.version||'0.0.0').split('.').map(x=>Number(x)||0),major=parts[0]||0,minor=parts[1]||0;
          if(major<4||(major===4&&minor<14))throw new Error(`Expected service >=4.14, got ${h.version}`);
"""
text = replace_once(text, old_check, new_check, 'semantic version check')

path.write_text(text, encoding='utf-8')
print('Live verifier now has connector trigger fallback and semantic-version parsing.')
