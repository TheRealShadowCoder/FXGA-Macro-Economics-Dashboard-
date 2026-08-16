import type { MacroObservation } from '../lib/types';
import { Sparkline } from './Sparkline';

export function MetricCard({ item }: { item: MacroObservation }) {
  const direction = item.change == null ? 'flat' : item.change > 0 ? 'up' : item.change < 0 ? 'down' : 'flat';
  const displayValue = item.value == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(item.value);
  return (
    <article className="metric-card">
      <div className="metric-head">
        <div>
          <span className="eyebrow">{item.seriesId}</span>
          <h3>{item.title}</h3>
        </div>
        <span className={`change ${direction}`}>
          {item.change == null ? 'n/a' : `${item.change > 0 ? '+' : ''}${item.change.toFixed(2)}`}
        </span>
      </div>
      <div className="metric-value">{displayValue}<small>{item.units}</small></div>
      <Sparkline values={item.history.map((row) => row.value)} />
      <div className="metric-foot">
        <span>{item.date ?? 'No observation'}</span>
        <span>{item.frequency}</span>
      </div>
    </article>
  );
}
