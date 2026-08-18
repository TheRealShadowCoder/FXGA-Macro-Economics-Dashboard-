import { useEffect, useState } from 'react';
import type { QualityFrameworkInput } from '../lib/quality-framework';
import { QualityCalibrationEvidencePanel } from './QualityCalibrationEvidencePanel';
import './QualityFrameworkDock.css';

export function QualityFrameworkDock() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<QualityFrameworkInput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/research', { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
      const text = await response.text();
      if (!response.ok) throw new Error(text || `Quality research request failed (${response.status})`);
      setData(JSON.parse(text) as QualityFrameworkInput);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Quality research is unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && !data && !loading) void load();
  }, [open, data, loading]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'q' && event.altKey) setOpen((value) => !value);
      if (event.key === 'Escape' && open) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return <>
    <button className="qce-dock-launcher" type="button" onClick={() => setOpen(true)} aria-label="Open 1000 method quality lab">
      <strong>1000</strong><span>Quality Lab</span>
    </button>
    {open && <div className="qce-dock-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="qce-dock-shell" role="dialog" aria-modal="true" aria-label="FXGA quality calibration and evidence lab">
        <div className="qce-dock-top">
          <div><span>Institutional research controls</span><strong>Quality · Calibration · Evidence</strong></div>
          <div className="qce-dock-actions"><button type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh evidence'}</button><button type="button" onClick={() => setOpen(false)}>Close</button></div>
        </div>
        <div className="qce-dock-content">
          {loading && !data ? <div className="loading-panel">Measuring live research quality…</div> : null}
          {error && !data ? <div className="alert error">{error}</div> : null}
          {data ? <QualityCalibrationEvidencePanel data={data} /> : null}
        </div>
      </div>
    </div>}
  </>;
}
