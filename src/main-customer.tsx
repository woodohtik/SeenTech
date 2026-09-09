import './lib/intlSetup';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import AppCustomer from './AppCustomer.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import { initLogger } from './lib/logger';
import './index-customer.css';
import './i18n/config-customer';

initLogger();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppCustomer />
    </ErrorBoundary>
  </StrictMode>,
);
