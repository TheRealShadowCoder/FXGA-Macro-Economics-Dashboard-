import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './google-cloud-routing';
import './live-signal-contract-guard';
import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { DashboardPerformanceGovernor } from './components/DashboardPerformanceGovernor';
import { DashboardCinematicLayer } from './components/DashboardCinematicLayer';
import { OptionalFeatureBoundary } from './components/OptionalFeatureBoundary';
import './google-live-refresh';
import './public-finish';
import './styles.css';
import './advanced.css';
import './responsive.css';
import './intelligence.css';
import './market-upgrades.css';
import './institutional.css';
import './institutional-finish.css';
import './runtime-upgrades.css';

const QualityFrameworkDock = lazy(() => import('./components/QualityFrameworkDock').then((module) => ({ default: module.QualityFrameworkDock })));
const FirestoreCapacityDock = lazy(() => import('./components/FirestoreCapacityDock').then((module) => ({ default: module.FirestoreCapacityDock })));
const MT5PriceCacheDock = lazy(() => import('./components/MT5PriceCacheDock').then((module) => ({ default: module.MT5PriceCacheDock })));
const ExplainabilityLayer = lazy(() => import('./components/ExplainabilityLayer').then((module) => ({ default: module.ExplainabilityLayer })));
const GeminiIntelligenceDock = lazy(() => import('./components/GeminiIntelligenceDock').then((module) => ({ default: module.GeminiIntelligenceDock })));
const EvidencePackDock = lazy(() => import('./components/EvidencePackDock').then((module) => ({ default: module.EvidencePackDock })));

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function DeferredEnhancements() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const runtime = window as IdleWindow;
    const handle = runtime.requestIdleCallback
      ? runtime.requestIdleCallback(() => setReady(true), { timeout: 900 })
      : window.setTimeout(() => setReady(true), 320);
    return () => {
      if (runtime.requestIdleCallback && runtime.cancelIdleCallback) runtime.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  if (!ready) return null;

  return (
    <Suspense fallback={null}>
      <OptionalFeatureBoundary name="Quality Framework"><QualityFrameworkDock /></OptionalFeatureBoundary>
      <OptionalFeatureBoundary name="D1 Capacity Ledger"><FirestoreCapacityDock /></OptionalFeatureBoundary>
      <OptionalFeatureBoundary name="MT5 Price Cache"><MT5PriceCacheDock /></OptionalFeatureBoundary>
      <OptionalFeatureBoundary name="Explainability Layer"><ExplainabilityLayer /></OptionalFeatureBoundary>
      <OptionalFeatureBoundary name="Gemini Intelligence"><GeminiIntelligenceDock /></OptionalFeatureBoundary>
      <OptionalFeatureBoundary name="Evidence Pack"><EvidencePackDock /></OptionalFeatureBoundary>
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DashboardPerformanceGovernor />
    <DashboardCinematicLayer />
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
    <DeferredEnhancements />
  </StrictMode>,
);