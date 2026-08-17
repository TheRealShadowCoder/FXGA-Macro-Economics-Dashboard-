import type { SessionSignalsPayload } from '../lib/types';

interface CurrencyState {
  currency: string;
  economy: string;
  centralBank: string;
  regime: string;
  policyStance: string;
  policyScore: number;
  score: number;
  confidence: number;
  observationCount: number;
  rank: number;
}

interface Opportunity {
  symbol: string;
  direction: 'BUY' | 'SELL' | 'WAIT';
  score: number;
  confidence: number;
  conviction: number;
  convictionLabel: 'high' | 'medium' | 'low';
  coverage: 'full' | 'partial' | 'event-only' | 'asset-model';
  risk: 'normal' | 'elevated' | 'event-lockout';
  executionGate: 'WAIT_EVENT' | 'NO_MACRO_EDGE' | 'AWAIT_TECHNICAL_CONFIRMATION';
  components: {
    structuralDivergence: number;
    policyDivergence: number;
    releaseDivergence: number;
    baseCurrencyScore: number;
    quoteCurrencyScore: number;
  };
  centralBankDivergence: string;
  regimes: string[];
  rationale: string[];
  catalyst?: string;
  catalystAt?: string;
  minutesToCatalyst?: number;
}

interface EnhancedSessionSignals extends SessionSignalsPayload {
  collectorMode?: string;
  economyObservationCount?: number;
  currencyStates?: CurrencyState[];
  rankedOpportunities?: Opportunity[];
  decisionSummary?: {
    actionableCount: number;
    waitCount: number;
    strongestCurrency: string | null;
    weakestCurrency: string | null;
    topOpportunity: null | {
      symbol: string;
      direction: 'BUY' | 'SELL' | 'WAIT';
      score: number;
      confidence: number;
      conviction: number;
      executionGate: string;
    };
  };
}

function signed(value: number) {
  return `${value > 0 ? '+' : ''}${value}`;
}

function scoreClass(value: number) {
  return value > 10 ? 'positive' : value < -10 ? 'negative' : 'neutral';
}

function gateLabel(gate: Opportunity['executionGate']) {
  if (gate === 'WAIT_EVENT') return 'Event lockout';
  if (gate === 'AWAIT_TECHNICAL_CONFIRMATION') return 'Technical confirmation required';
  return 'No macro edge';
}

function catalystLabel(item: Opportunity) {
  if (!item.catalyst) return 'No immediate catalyst';
  const minutes = item.minutesToCatalyst;
  if (typeof minutes !== 'number') return item.catalyst;
  if (minutes <= 0) return `${item.catalyst} · now`;
  if (minutes < 60) return `${item.catalyst} · ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${item.catalyst} · ${hours}h${remainder ? ` ${remainder}m` : ''}`;
}

export function DecisionIntelligence({ data }: { data: SessionSignalsPayload }) {
  const intelligence = data as EnhancedSessionSignals;
  const currencies = intelligence.currencyStates ?? [];
  const opportunities = intelligence.rankedOpportunities ?? [];
  const summary = intelligence.decisionSummary;
  if (!currencies.length && !opportunities.length) return null;

  return (
    <>
      <section className="decision-hero panel">
        <div className="decision-heading">
          <span className="eyebrow">FXGA Global Decision Engine</span>
          <h2>Macro edge before technical execution</h2>
          <p>Each FX pair is scored base economy versus quote economy. Structural macro, central-bank reaction and released-data surprise remain separate so every bias can be audited.</p>
        </div>
        <div className="decision-kpis">
          <div><small>Strongest currency</small><strong>{summary?.strongestCurrency ?? '—'}</strong></div>
          <div><small>Weakest currency</small><strong>{summary?.weakestCurrency ?? '—'}</strong></div>
          <div><small>Actionable macro edges</small><strong>{summary?.actionableCount ?? 0}</strong></div>
          <div><small>Economy observations</small><strong>{intelligence.economyObservationCount ?? '—'}</strong></div>
        </div>
        {summary?.topOpportunity && (
          <div className="top-opportunity">
            <div><small>Highest ranked macro edge</small><strong>{summary.topOpportunity.symbol}</strong></div>
            <span className={`signal-direction ${summary.topOpportunity.direction.toLowerCase()}`}>{summary.topOpportunity.direction}</span>
            <b className={scoreClass(summary.topOpportunity.score)}>{signed(summary.topOpportunity.score)}</b>
            <em>{summary.topOpportunity.confidence}% confidence · conviction {summary.topOpportunity.conviction}/100</em>
          </div>
        )}
      </section>

      {currencies.length > 0 && (
        <>
          <section className="section-head"><div><span className="eyebrow">Currency Strength Map</span><h2>Five-economy structural ranking</h2><p>Ranked from the independent macro state of each economy, not from spot-price momentum.</p></div></section>
          <section className="currency-strength-grid">
            {currencies.map((currency) => (
              <article className="currency-strength-card" key={currency.currency}>
                <div className="currency-rank">#{currency.rank}</div>
                <div className="currency-strength-head">
                  <div><span className="eyebrow">{currency.economy}</span><h3>{currency.currency}</h3></div>
                  <strong className={scoreClass(currency.score)}>{signed(currency.score)}</strong>
                </div>
                <div className="currency-strength-meta">
                  <span><small>Regime</small>{currency.regime}</span>
                  <span><small>{currency.centralBank}</small>{currency.policyStance}</span>
                  <span><small>Reaction score</small><b className={scoreClass(currency.policyScore)}>{signed(currency.policyScore)}</b></span>
                  <span><small>Confidence</small>{currency.confidence}%</span>
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      {opportunities.length > 0 && (
        <>
          <section className="section-head"><div><span className="eyebrow">Macro Divergence Scanner</span><h2>Ranked pair and cross-asset opportunities</h2><p>BUY/SELL identifies the macro-favoured side only. Entries remain blocked until the technical execution gate is satisfied.</p></div></section>
          <section className="opportunity-board panel">
            {opportunities.slice(0, 10).map((item, index) => (
              <article className={`opportunity-row ${item.risk}`} key={item.symbol}>
                <div className="opportunity-rank">{String(index + 1).padStart(2, '0')}</div>
                <div className="opportunity-symbol">
                  <strong>{item.symbol}</strong>
                  <span>{item.coverage} coverage · {item.convictionLabel} conviction</span>
                </div>
                <div className={`signal-direction ${item.direction.toLowerCase()}`}>{item.direction}</div>
                <div className="opportunity-score">
                  <strong className={scoreClass(item.score)}>{signed(item.score)}</strong>
                  <span>{item.confidence}% confidence</span>
                </div>
                <div className="opportunity-components">
                  <span><small>Structure</small><b className={scoreClass(item.components.structuralDivergence)}>{signed(item.components.structuralDivergence)}</b></span>
                  <span><small>Policy</small><b className={scoreClass(item.components.policyDivergence)}>{signed(item.components.policyDivergence)}</b></span>
                  <span><small>Release</small><b className={scoreClass(item.components.releaseDivergence)}>{signed(item.components.releaseDivergence)}</b></span>
                </div>
                <div className="opportunity-context">
                  <span>{item.centralBankDivergence}</span>
                  <small>{catalystLabel(item)}</small>
                </div>
                <div className={`execution-gate ${item.executionGate.toLowerCase()}`}>{gateLabel(item.executionGate)}</div>
              </article>
            ))}
          </section>
        </>
      )}
    </>
  );
}
