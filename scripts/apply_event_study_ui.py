from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'src/App.tsx'
text=path.read_text(encoding='utf-8')

def replace_once(old,new,label):
    global text
    if old not in text: raise SystemExit(f'UI patch anchor missing: {label}')
    text=text.replace(old,new,1)

replace_once(
    "import { SignalsView } from './components/SignalsView';",
    "import { SignalsView } from './components/SignalsView';\nimport { EventStudyPanel } from './components/EventStudyPanel';",
    'event study import')
replace_once(
    "            <section className=\"panel full\"><div className=\"panel-title\"><div><span className=\"eyebrow\">Past 7 days + upcoming · Actual · Consensus · Previous · Currency bias</span><h2>Economic calendar and backtest history</h2></div><span>{filteredCalendar.length} events</span></div>{filteredCalendar.length ? filteredCalendar.map((event) => <CalendarRow key={event.id} event={event} />) : <div className=\"empty\">No persisted calendar events are currently available in the selected window.</div>}</section>",
    "            <section className=\"panel full\"><div className=\"panel-title\"><div><span className=\"eyebrow\">Past 7 days + upcoming · Actual · Consensus · Previous · Currency bias</span><h2>Economic calendar and backtest history</h2></div><span>{filteredCalendar.length} events</span></div>{filteredCalendar.length ? filteredCalendar.map((event) => <CalendarRow key={event.id} event={event} />) : <div className=\"empty\">No persisted calendar events are currently available in the selected window.</div>}</section>\n            <EventStudyPanel />",
    'event study render')
path.write_text(text,encoding='utf-8')
print('Event-study dashboard integration applied successfully.')
