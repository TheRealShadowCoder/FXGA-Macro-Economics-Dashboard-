import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './google-live-refresh';
import './styles.css';
import './advanced.css';
import './responsive.css';
import './intelligence.css';
import './market-upgrades.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
