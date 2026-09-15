import './lib/intlSetup';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import AppCustomer from './AppCustomer.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import { initLogger } from './lib/logger';
import './index-customer.css';
import { ready as i18nReady } from './i18n/config-customer';

initLogger();

// Resolves on the same tick (config-customer.ts loads its resources
// eagerly) -- awaited for symmetry with main.tsx and in case that ever
// changes, not because this build actually waits on a network fetch.
i18nReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <AppCustomer />
      </ErrorBoundary>
    </StrictMode>,
  );
});
