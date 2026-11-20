import './lib/intlSetup';
// Imported first on purpose (seen-performance-first-open-login-task.md
// Phase 1): modules evaluate in import order, so this starts fetching the
// language core before the rest of the app's code is evaluated.
import { ready as i18nReady } from './i18n/config';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import { initLogger } from './lib/logger';
import { initPwaUpdates } from './lib/pwaUpdate';
import './index.css';

initLogger();
initPwaUpdates();

// i18nReady resolves once the active language's core translations have
// loaded (see i18n/config.ts) -- awaited here so the very first render
// already has real text, not a flash of raw translation keys. Until then
// the static splash in index.html is on screen.
i18nReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
});
