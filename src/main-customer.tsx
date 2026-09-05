import './lib/intlSetup';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import AppCustomer from './AppCustomer.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import './index-customer.css';
import './i18n/config-customer';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppCustomer />
    </ErrorBoundary>
  </StrictMode>,
);
