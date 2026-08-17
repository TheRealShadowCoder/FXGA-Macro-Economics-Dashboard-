from pathlib import Path

server = Path('cloud-run-collector/src/server-v2.js')
text = server.read_text()
old = "function taskOffsets(maxImportance) {\n  if (maxImportance>=3) return [0,60,300,900,3600,14400];\n  if (maxImportance===2) return [0,300,900,3600,14400];\n  return [0,900,3600];\n}"
new = "function taskOffsets(maxImportance) {\n  // Negative offsets intentionally capture a verified pre-release market baseline.\n  // The release-check gateway triggers market-sync after every successful check,\n  // so the -5m task seeds the strict event-study baseline without fabricating prices.\n  if (maxImportance>=3) return [-300,0,60,300,900,3600,14400];\n  if (maxImportance===2) return [-300,0,300,900,3600,14400];\n  return [-900,0,900,3600];\n}"
if old not in text:
    raise SystemExit('Expected taskOffsets block not found; refusing unsafe patch')
server.write_text(text.replace(old, new, 1))

package = Path('cloud-run-collector/package.json')
package_text = package.read_text()
if '"version": "4.5.0"' not in package_text:
    raise SystemExit('Expected collector version 4.5.0 not found')
package.write_text(package_text.replace('"version": "4.5.0"', '"version": "4.6.0"', 1))
