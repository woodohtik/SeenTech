import './lib/intlSetup';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import { initLogger } from './lib/logger';
import { initPwaUpdates } from './lib/pwaUpdate';
import './index.css';
import { ready as i18nReady } from './i18n/config';

initLogger();
initPwaUpdates();

// i18nReady resolves once the active language's translations have actually
// loaded (see i18n/config.ts) -- awaited here so the very first render
// already has real text, not a flash of raw translation keys.
i18nReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
});
