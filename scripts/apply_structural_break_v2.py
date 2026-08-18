from pathlib import Path
import runpy

# Compatibility entrypoint retained for existing workflows/finalizers.
# The v3 patch contains the exact current-source anchors.
target = Path(__file__).with_name('apply_structural_break_v3.py')
if not target.exists():
    raise SystemExit(f'Missing structural-break patch: {target}')
runpy.run_path(str(target), run_name='__main__')
