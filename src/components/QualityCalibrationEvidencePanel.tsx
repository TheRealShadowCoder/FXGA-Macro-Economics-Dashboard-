import { useMemo, useState } from 'react';
import { deriveQualityFramework, QUALITY_FAMILIES, QUALITY_METHOD_REGISTRY, type QualityFrameworkInput, type QualityMethodState } from '../lib/quality-framework';
import './QualityCalibrationEvidencePanel.css';

const stateLabel: Record<QualityMethodState, string> = {
  measured: 'Measured',
  supported: 'Partial evidence',
  registered: 'Registered',
  gated: 'Quality gate',
};

const statusClass = (score: number) => score >= 70 ? 'positive' : score >= 50 ? 'neutral' : 'negative';

type ServerFamily = {
  id: string;
  label: string;
  shortLabel: string;
  registeredMethods: number;
  score: number;
  confidence: number;
  evidencePoints: number;
  state: QualityMethodState;
  note?: string;
};

type ServerQualityAudit = {
  engine?: string;
  registeredMethods: number;
  registeredFamilies?: number;
  measuredFamilies: number;
  supportedFamilies: number;
  overall: number;
  status: 'qualified' | 'watch' | 'insufficient';
  pillars: {
    dataQuality: number;
    calibrationQuality: number;
    evidenceQuality: number;
    robustnessQuality: number;
    governanceQuality: number;
  };
  families: ServerFamily[];
  nonFabricationPolicy?: string;
  methodology?: string;
};

type QualityInputWithServerAudit = QualityFrameworkInput & { qualityCalibrationEvidence?: ServerQualityAudit | null };

export function QualityCalibrationEvidencePanel({ data }: { data: QualityFrameworkInput }) {
  const serverAudit = (data as QualityInputWithServerAudit).qualityCalibrationEvidence;
  const authoritative = Boolean(serverAudit?.registeredMethods === 1000 && serverAudit?.families?.length === 20);
  const result = useMemo(() => {
    const fallback = deriveQualityFramework(data);
    if (!serverAudit || serverAudit.registeredMethods !== 1000 || serverAudit.families?.length !== 20) return fallback;
    const definitions = new Map(QUALITY_FAMILIES.map((family) => [family.id, family]));
    return {
      totalRegisteredMethods: serverAudit.registeredMethods,
      measuredFamilies: serverAudit.measuredFamilies,
      supportedFamilies: serverAudit.supportedFamilies,
      overall: serverAudit.overall,
      status: serverAudit.status,
      dataQuality: serverAudit.pillars.dataQuality,
      calibrationQuality: serverAudit.pillars.calibrationQuality,
      evidenceQuality: serverAudit.pillars.evidenceQuality,
      robustnessQuality: serverAudit.pillars.robustnessQuality,
      governanceQuality: serverAudit.pillars.governanceQuality,
      families: serverAudit.families.map((item) => {
        const definition = definitions.get(item.id);
        return {
          id: item.id,
          label: item.label || definition?.label || item.id,
          shortLabel: item.shortLabel || definition?.shortLabel || item.id,
          description: definition?.description || 'Institutional quality-control family.',
          score: item.score,
          confidence: item.confidence,
          state: item.state,
          registeredMethods: item.registeredMethods,
          evidencePoints: item.evidencePoints,
          notes: item.note ? [item.note] : [],
        };
      }),
    };
  }, [data, serverAudit]);
  const [selectedFamily, setSelectedFamily] = useState('probability-calibration');
  const family = result.families.find((item) => item.id === selectedFamily) ?? result.families[0];
  const methods = useMemo(() => QUALITY_METHOD_REGISTRY.filter((method) => method.familyId === family.id), [family.id]);

  const pillars = [
    ['Data quality', result.dataQuality, 'data-quality'],
    ['Calibration', result.calibrationQuality, 'calibration'],
    ['Evidence', result.evidenceQuality, 'evidence-quality'],
    ['Robustness', result.robustnessQuality, 'robustness'],
    ['Governance', result.governanceQuality, 'governance'],
  ] as const;

  return <section className="qce-workspace" aria-label="Quality calibration and evidence framework">
    <div className="section-head qce-heading">
      <div>
        <span className="eyebrow">FXGA Institutional Quality Framework · {authoritative ? 'Cloud Run authoritative audit' : 'local fallback audit'}</span>
        <h2>1,000 method quality, calibration and evidence control layer</h2>
        <p>Twenty research-control families with fifty registered methods each. Scores only use evidence currently exposed by the research engine. A registered method is never presented as measured until supporting evidence exists.</p>
        {serverAudit?.nonFabricationPolicy ? <p className="qce-note">{serverAudit.nonFabricationPolicy}</p> : null}
      </div>
      <div className={`qce-overall ${statusClass(result.overall)}`} data-explain-key="fxga-quality-score">
        <span>FXGA quality</span><strong>{result.overall}</strong><small>{result.status}</small>
      </div>
    </div>

    <div className="qce-pillars">
      {pillars.map(([label, value, explainKey]) => <article key={label} data-explain-key={explainKey}>
        <span>{label}</span><strong className={statusClass(value)}>{value}</strong>
        <div className="qce-meter"><i style={{ width: `${value}%` }} /></div>
      </article>)}
    </div>

    <div className="qce-register-strip">
      <div data-explain-key="registered-methods"><strong>{result.totalRegisteredMethods}</strong><span>registered methods</span></div>
      <div data-explain-key="measured-families"><strong>{result.measuredFamilies}/20</strong><span>fully measured families</span></div>
      <div data-explain-key="supported-families"><strong>{result.supportedFamilies}/20</strong><span>families with usable evidence</span></div>
      <div data-explain-key="quality-gate"><strong>{result.status.toUpperCase()}</strong><span>decision-quality state</span></div>
    </div>

    <div className="qce-family-grid">
      {result.families.map((item) => <button
        key={item.id}
        type="button"
        className={`qce-family ${item.id === family.id ? 'active' : ''}`}
        onClick={() => setSelectedFamily(item.id)}
        data-explain-key={item.id}
      >
        <div><span>{item.shortLabel}</span><b className={statusClass(item.score)}>{item.score}</b></div>
        <div className="qce-family-meter"><i style={{ width: `${item.score}%` }} /></div>
        <small>{stateLabel[item.state]} · confidence {item.confidence}% · evidence {item.evidencePoints}</small>
      </button>)}
    </div>

    <article className="panel qce-method-explorer">
      <div className="qce-method-head">
        <div>
          <span className="eyebrow">Method Registry · {authoritative ? 'server scored' : 'fallback scored'}</span>
          <h3>{family.label}</h3>
          <p>{family.description}</p>
        </div>
        <div className="qce-family-score" data-explain-key={family.id}><strong className={statusClass(family.score)}>{family.score}</strong><span>{stateLabel[family.state]}</span></div>
      </div>
      {family.notes.map((note, index) => <p className="qce-note" key={index}>{note}</p>)}
      <div className="qce-method-list">
        {methods.map((method, index) => <div className="qce-method-row" key={method.id} data-explain-key={family.id}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <div><strong>{method.label}</strong><small>{method.purpose}</small></div>
          <b>{method.technique}</b>
        </div>)}
      </div>
    </article>
  </section>;
}
