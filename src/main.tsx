import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './google-cloud-routing';
import App from './App';
import { ExplainabilityLayer } from './components/ExplainabilityLayer';
import { QualityFrameworkDock } from './components/QualityFrameworkDock';
import { FirestoreCapacityDock } from './components/FirestoreCapacityDock';
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
    <App />
    <QualityFrameworkDock />
    <FirestoreCapacityDock />
    <ExplainabilityLayer />
  </StrictMode>,
);
