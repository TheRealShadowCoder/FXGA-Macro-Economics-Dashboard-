import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './google-cloud-routing';
import './live-signal-contract-guard';
import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { ExplainabilityLayer } from './components/ExplainabilityLayer';
import { QualityFrameworkDock } from './components/QualityFrameworkDock';
import { FirestoreCapacityDock } from './components/FirestoreCapacityDock';
import { MT5PriceCacheDock } from './components/MT5PriceCacheDock';
import { GeminiIntelligenceDock } from './components/GeminiIntelligenceDock';
import { EvidencePackDock } from './components/EvidencePackDock';
import './google-live-refresh';
import './public-finish';
import './styles.css';
import './advanced.css';
import './responsive.css';
import './intelligence.css';
import './market-upgrades.css';
import './institutional.css';
import './institutional-finish.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
    <QualityFrameworkDock />
    <FirestoreCapacityDock />
    <MT5PriceCacheDock />
    <ExplainabilityLayer />
    <GeminiIntelligenceDock />
    <EvidencePackDock />
  </StrictMode>,
);