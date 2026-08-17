from pathlib import Path

server = Path('cloud-run-collector/src/server-v2.js')
text = server.read_text()
old = """  const studyEvents=next.filter((event)=>eventIds.includes(event.id));
  const eventStudy=EVENT_STUDY_HORIZONS[Number(offsetSeconds)]?await captureEventStudies(studyEvents,releaseAt,Number(offsetSeconds)):null;
  return {changed:changed.length,releaseAt,offsetSeconds,eventStudy};
}"""
new = """  const studyEvents=next.filter((event)=>eventIds.includes(event.id));
  // A negative release offset is the strict pre-release baseline task. Persist the
  // market snapshot before returning so scale-to-zero cannot interrupt the capture.
  const preReleaseMarket=Number(offsetSeconds)<0?await syncCnbcMarket():null;
  const eventStudy=EVENT_STUDY_HORIZONS[Number(offsetSeconds)]?await captureEventStudies(studyEvents,releaseAt,Number(offsetSeconds)):null;
  return {changed:changed.length,releaseAt,offsetSeconds,preReleaseMarket,eventStudy};
}"""
if old not in text:
    raise SystemExit('Expected releaseCheck event-study block not found; refusing unsafe patch')
server.write_text(text.replace(old, new, 1))

launcher = Path('cloud-run-collector/src/launcher.js')
launcher_text = launcher.read_text()
old_launcher = """      const forceNews=url.pathname==='/bootstrap';
      if(url.pathname==='/release-check')fetch(`http://127.0.0.1:${internalPort}/market-sync`,{method:'POST'}).catch(e=>console.warn('Release-aligned market snapshot deferred',String(e?.message||e)));
      refreshSuperEconomist({forceNews}).then(x=>console.log('Intelligence refresh',JSON.stringify({trigger:url.pathname,...x}))).catch(e=>console.error('Intelligence refresh failed',e));"""
new_launcher = """      const forceNews=url.pathname==='/bootstrap';
      // Release-aligned market persistence is awaited inside releaseCheck itself.
      // Avoid a duplicate background market-sync after the HTTP response is sent.
      refreshSuperEconomist({forceNews}).then(x=>console.log('Intelligence refresh',JSON.stringify({trigger:url.pathname,...x}))).catch(e=>console.error('Intelligence refresh failed',e));"""
if old_launcher not in launcher_text:
    raise SystemExit('Expected launcher release-check background capture not found; refusing unsafe patch')
launcher.write_text(launcher_text.replace(old_launcher, new_launcher, 1))

package = Path('cloud-run-collector/package.json')
package_text = package.read_text()
if '"version": "4.6.1"' not in package_text:
    raise SystemExit('Expected collector version 4.6.1 not found')
package.write_text(package_text.replace('"version": "4.6.1"', '"version": "4.6.2"', 1))
