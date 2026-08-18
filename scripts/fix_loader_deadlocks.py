from pathlib import Path

path = Path('src/App.tsx')
text = path.read_text(encoding='utf-8')

replacements = {
"""    return () => { cancelled = true; };\n  }, [view, analysis]);""": """    return () => { cancelled = true; setAnalysisLoading(false); };\n  }, [view, analysis]);""",
"""    return () => { cancelled = true; };\n  }, [view, signals]);""": """    return () => { cancelled = true; setSignalsLoading(false); };\n  }, [view, signals]);""",
"""    return () => { cancelled = true; };\n  }, [view, catalog]);""": """    return () => { cancelled = true; setCatalogLoading(false); };\n  }, [view, catalog]);""",
"""    return () => { cancelled = true; };\n  }, [view, catalog, universeCategory]);""": """    return () => { cancelled = true; setUniverseLoading(false); };\n  }, [view, catalog, universeCategory]);""",
"""    return () => { cancelled = true; };\n  }, [view, acquisitionCatalog]);""": """    return () => { cancelled = true; setAcquisitionLoading(false); };\n  }, [view, acquisitionCatalog]);""",
}

for old, new in replacements.items():
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one loader cleanup anchor, found {count}: {old[:80]!r}')
    text = text.replace(old, new, 1)

# Refresh must also clear a previously wedged loading flag before invalidating data.
old_refresh = """  const refreshCurrent = () => {\n    if (view === 'analysis') setAnalysis(null);\n    else if (view === 'signals') setSignals(null);\n    else if (view === 'acquisition') setAcquisitionCatalog(null);\n    else if (view === 'universe') { setCatalog(null); setUniverseSeries([]); }\n    else void load();\n  };"""
new_refresh = """  const refreshCurrent = () => {\n    if (view === 'analysis') { setAnalysisLoading(false); setAnalysis(null); }\n    else if (view === 'signals') { setSignalsLoading(false); setSignals(null); }\n    else if (view === 'acquisition') { setAcquisitionLoading(false); setAcquisitionCatalog(null); }\n    else if (view === 'universe') { setCatalogLoading(false); setUniverseLoading(false); setCatalog(null); setUniverseSeries([]); }\n    else void load();\n  };"""
if text.count(old_refresh) != 1:
    raise SystemExit('Refresh handler anchor changed; refusing an unsafe patch.')
text = text.replace(old_refresh, new_refresh, 1)

path.write_text(text, encoding='utf-8')

# Regression guard: every cancellable async view must explicitly release its loading latch.
required = [
    'cancelled = true; setAnalysisLoading(false)',
    'cancelled = true; setSignalsLoading(false)',
    'cancelled = true; setCatalogLoading(false)',
    'cancelled = true; setUniverseLoading(false)',
    'cancelled = true; setAcquisitionLoading(false)',
]
for needle in required:
    if needle not in text:
        raise SystemExit(f'Missing loader release guard: {needle}')
print('Loader deadlock repair applied successfully.')
