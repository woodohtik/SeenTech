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
import { startVersionChecks } from './lib/appVersion';
import { reportUpdate } from './lib/updateManager';
import { installActingSessionFetch } from './lib/actingSession';
import './index.css';

initLogger();
initPwaUpdates();
// seen-update-delivery-fix-task.md: learn of a new build from /version.json
// (phase 2) and apply it when the screen is safe (phase 3).
startVersionChecks({ onUpdate: reportUpdate });
// Phase 4.5 (a code file that fails to load): handled by ErrorBoundary --
// one guarded recovery, then the calm "updating" screen. No vite:preloadError
// handler on purpose: cancelling that event makes the import resolve empty,
// which broke the page in the two-build test instead of recovering it.
// seen-permissions-fix-task.md Phase 2: the PIN session header on every backend request.
installActingSessionFetch(String(import.meta.env.VITE_SUPABASE_URL || ''));

// i18nReady resolves once the active language's core translations have
// loaded (see i18n/config.ts) -- awaited here so the very first render
// already has real text, not a flash of raw translation keys. Until then
// the static splash in index.html is on screen.
// P3.4 (RELIABILITY-17): render even if the translations failed to load.
i18nReady.catch((err) => console.error('[i18n] not ready', err)).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
});
