from pathlib import Path

path=Path('.github/workflows/verify-v414-live-direct.yml')
text=path.read_text(encoding='utf-8')
old1="""          node <<'NODE'
          const fs=require('fs');
          const base=process.env.SERVICE_URL,token=process.env.TOKEN,sleep=ms=>new Promise(r=>setTimeout(r,ms));
"""
new1="""          node --input-type=module <<'NODE'
          import fs from 'node:fs';
          const base=process.env.SERVICE_URL,token=process.env.TOKEN,sleep=ms=>new Promise(r=>setTimeout(r,ms));
"""
old2="""          node <<'NODE'
          const fs=require('fs'),base='https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev',sleep=ms=>new Promise(r=>setTimeout(r,ms));
"""
new2="""          node --input-type=module <<'NODE'
          import fs from 'node:fs';
          const base='https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev',sleep=ms=>new Promise(r=>setTimeout(r,ms));
"""
for label,old,new in [('private verifier',old1,new1),('public verifier',old2,new2)]:
    if old in text:text=text.replace(old,new,1)
    elif new not in text:raise SystemExit(f'{label} anchor missing')
path.write_text(text,encoding='utf-8')
print('Direct v4.14 live verifier now uses explicit ES modules for top-level await.')
