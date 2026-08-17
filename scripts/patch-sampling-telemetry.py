from pathlib import Path

server = Path('cloud-run-collector/src/server-v2.js')
text = server.read_text()
old = "return {clusters:clusters.size,tasksCreated:created};"
new = "return {clusters:clusters.size,tasksCreated:created,samplingPolicy:{highImpactSeconds:taskOffsets(3),mediumImpactSeconds:taskOffsets(2),lowImpactSeconds:taskOffsets(1),preReleaseBaselineAwaited:true,eventStudyHorizonsSeconds:[300,900,3600,14400]}};"
if old not in text:
    raise SystemExit('Expected scheduleReleaseTasks return contract not found; refusing unsafe patch')
server.write_text(text.replace(old, new, 1))

package = Path('cloud-run-collector/package.json')
package_text = package.read_text()
if '"version": "4.7.0"' not in package_text:
    raise SystemExit('Expected collector version 4.7.0 not found')
package.write_text(package_text.replace('"version": "4.7.0"', '"version": "4.7.1"', 1))
