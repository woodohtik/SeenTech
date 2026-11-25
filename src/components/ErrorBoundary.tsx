import React, { Component, ErrorInfo } from 'react';
import { AlertCircle, RefreshCcw, Home, Terminal } from 'lucide-react';
import { logError } from '../lib/logger';
import i18n from 'i18next';
import { dirOf } from '../lib/direction';
import { claimAutoRecovery, hardRecover, isChunkLoadError, recoverFromStaleBuild } from '../lib/chunkRecovery';

interface ErrorBoundaryProps {
  children?: React.ReactNode;
  /**
   * 'full' (default): شاشة خطأ كاملة تملأ الصفحة — يبقى هذا فقط على الغلاف
   * الأعلى في main.tsx كخط الدفاع الأخير. 'inline': بطاقة صغيرة داخل مكانها
   * (لا تُسقط بقية الصفحة)، وزر إعادة المحاولة يعيد تعيين حالة هذا الـ
   * boundary فقط دون window.location.reload().
   */
  variant?: 'full' | 'inline';
  /** عنوان مختصر اختياري يظهر في بطاقة الـ inline (مثلاً اسم الودجت المعطوب). */
  inlineLabel?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  eventId: string | null;
  isLazyLoadError: boolean;
  /** P3.4 (RELIABILITY-09): the page's code is not on this device and there is no network. */
  isOfflineChunkError: boolean;
  /** The automatic try already ran in the last minute: one button, no more reloads. */
  isStaleBuildError: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
    eventId: null,
    isLazyLoadError: false,
    isOfflineChunkError: false,
    isStaleBuildError: false,
  };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidMount() {
    // فقط الغلاف الأعلى (full، الافتراضي) يستمع لأخطاء window العامة —
    // boundaries الـ inline المتعددة (صفحة لكل مسار + ودجت المساعد) قد
    // تكون عدة نسخ مُركّبة في آن واحد، فلو استمعت كلها لنفس أحداث window
    // لتكرر تسجيل نفس الخطأ العام مرات بعدد الـ boundaries المركّبة.
    if (this.props.variant !== 'inline') {
      window.addEventListener('unhandledrejection', this.handlePromiseRejection);
      window.addEventListener('error', this.handleGlobalError);
    }
  }

  componentWillUnmount() {
    if (this.props.variant !== 'inline') {
      window.removeEventListener('unhandledrejection', this.handlePromiseRejection);
      window.removeEventListener('error', this.handleGlobalError);
    }
  }

  handlePromiseRejection = (event: PromiseRejectionEvent) => {
    event.preventDefault();
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    let reasonStr = ""; try { reasonStr = event.reason instanceof Error ? event.reason.stack || event.reason.message : JSON.stringify(event.reason); } catch(e) { reasonStr = String(event.reason); } logError(error, { source: 'Unhandled Promise Rejection', detail: reasonStr });
  };

  handleGlobalError = (event: ErrorEvent) => {
    logError(event.error, { source: 'Global Error' });
  };

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn('React ErrorBoundary caught an error:', error, errorInfo);
    
    // A code file of this page could not be loaded: this tab runs an older
    // build whose files are gone (seen-update-delivery-fix-task.md 0.5).
    if (isChunkLoadError(error)) {
      // Offline the code can't be fetched, and a reload would only fail again.
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offline) {
        logError(error, { errorInfo, source: 'ErrorBoundary:lazy-load-offline', offline });
        this.setState({ isOfflineChunkError: true });
        return;
      }
      // One automatic try per minute for the whole app (not per page: the
      // loop in the 23 Nov video moved between pages). It lets a new service
      // worker take over before reloading, so the reload can land on the new
      // build instead of the same old one.
      if (claimAutoRecovery()) {
        logError(error, { errorInfo, source: 'ErrorBoundary:lazy-load-reload' });
        this.setState({ isLazyLoadError: true });
        void recoverFromStaleBuild();
        return;
      }
      logError(error, { errorInfo, source: 'ErrorBoundary:lazy-load-stale' });
      this.setState({ isStaleBuildError: true });
      return;
    }

    try {
      // The Sentry event when Sentry is on (support finds it by this), the time otherwise.
      const at = new Date().getTime().toString();
      const eventId = logError(error, { errorInfo, source: 'ErrorBoundary', at }) ?? at;
      this.setState({ errorInfo, eventId });
    } catch(e) {
      console.warn('Failed to log error inside ErrorBoundary:', e);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, eventId: null });
    window.location.reload();
  };

  /** يعيد تعيين حالة هذا الـ boundary فقط — بلا إعادة تحميل الصفحة. */
  handleInlineRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, eventId: null });
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, eventId: null });
    window.location.href = '/';
  };

  render() {
    const { hasError, error, eventId, isLazyLoadError, isOfflineChunkError, isStaleBuildError } = this.state;

    if (isStaleBuildError) {
      // Calm and still: no spinner, no automatic reload. The one button clears
      // the service worker and the caches and loads from the network.
      return (
        <div className={this.props.variant === 'inline'
          ? 'bg-surface border border-border rounded-2xl p-5 flex flex-col items-center gap-3 text-content'
          : 'min-h-screen bg-surface-muted flex flex-col items-center justify-center gap-4 p-4 text-content'} dir={dirOf()} role="alert">
          <p className="font-bold text-base">{i18n.t('errors.updating_system_title')}</p>
          <p className="text-sm text-content-muted text-center max-w-xs">{i18n.t('errors.updating_system_body')}</p>
          <button type="button" onClick={() => { void hardRecover(); }}
            className="min-h-12 px-6 rounded-[8px] bg-brand text-white font-semibold text-base">
            {i18n.t('errors.update_button')}
          </button>
        </div>
      );
    }

    if (isOfflineChunkError) {
      return (
        <div className={this.props.variant === 'inline'
          ? 'bg-surface-muted border border-border rounded-2xl p-5 flex flex-col items-center gap-3 text-content'
          : 'min-h-screen bg-surface-muted flex flex-col items-center justify-center gap-4 p-4 text-content'} dir={dirOf()} role="alert">
          <p className="font-bold text-sm text-center">{i18n.t('errors.page_offline')}</p>
          <button type="button" onClick={() => window.location.assign('/sales')}
            className="min-h-11 px-5 rounded-xl bg-brand text-white font-bold text-sm">
            {i18n.t('errors.back_to_pos')}
          </button>
        </div>
      );
    }

    if (isLazyLoadError) {
      if (this.props.variant === 'inline') {
        return (
          <div className="bg-surface-muted border border-border rounded-2xl p-5 flex flex-col items-center gap-3 text-content-muted" dir={dirOf()}>
            <RefreshCcw size={20} className="animate-spin" />
            <p className="font-bold text-sm">{i18n.t('errors.updating')}</p>
          </div>
        );
      }

      return (
        <div className="min-h-screen bg-surface-muted flex items-center justify-center p-4" dir={dirOf()}>
          <div className="flex flex-col items-center gap-4 text-content-muted">
            <RefreshCcw size={32} className="animate-spin" />
            <p className="font-bold text-sm">{i18n.t('errors.updating')}</p>
          </div>
        </div>
      );
    }

    if (hasError) {
      let errorMessage = i18n.t('errors.unexpected');
      let isPermissionError = false;

      try {
        if (error?.message) {
          // Check if it's our stringified FirestoreErrorInfo
          const parsed = JSON.parse(error.message);
          
          if (parsed.error && (
            parsed.error.includes('permission-denied') || 
            parsed.error.includes('Missing or insufficient permissions') ||
            parsed.error.includes('insufficient permissions')
          )) {
            errorMessage = i18n.t('errors.insufficient_permissions');
            isPermissionError = true;
          } else if (parsed.error && parsed.error.includes('offline')) {
            errorMessage = i18n.t('errors.offline');
          }
        }
      } catch (e) {
        // Not JSON or parsing failed
        if (error?.message?.toLowerCase().includes('fetch') || error?.message?.toLowerCase().includes('network')) {
           errorMessage = i18n.t('errors.network');
        }
      }

      if (this.props.variant === 'inline') {
        return (
          <div className="bg-danger/5 border border-danger/20 rounded-2xl p-5 text-center font-sansSelection" dir={dirOf()}>
            <div className="w-11 h-11 bg-danger/10 rounded-full flex items-center justify-center mx-auto mb-3">
              <AlertCircle className="text-danger" size={22} />
            </div>
            {this.props.inlineLabel && (
              <p className="text-sm font-black text-content-muted mb-1">{this.props.inlineLabel}</p>
            )}
            <p className="text-content-muted font-bold text-sm mb-4 leading-relaxed">
              {isPermissionError ? i18n.t('errors.permission_error_title') : errorMessage}
            </p>
            <button
              onClick={this.handleInlineRetry}
              className="inline-flex items-center justify-center gap-2 bg-content text-white px-5 py-2.5 rounded-xl font-black text-sm hover:bg-black transition-all"
            >
              <RefreshCcw size={14} />
              {i18n.t('common.retry')}
            </button>
          </div>
        );
      }

      return (
        <div className="min-h-screen bg-surface-muted flex items-center justify-center p-4 font-sansSelection" dir={dirOf()}>
          <div className="max-w-md w-full bg-surface rounded-3xl shadow-2xl border border-border p-10 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-danger to-danger"></div>
            
            <div className="w-24 h-24 bg-danger/10 rounded-full flex items-center justify-center mx-auto mb-8 animate-pulse">
              <AlertCircle className="text-danger" size={48} />
            </div>
            
            <h1 className="text-2xl font-black text-content mb-2">
              {isPermissionError ? i18n.t('errors.permission_error_title') : i18n.t('errors.generic_title')}
            </h1>
            
            <p className="text-content-muted font-bold mb-8 leading-relaxed">
              {errorMessage}
            </p>

            <div className="space-y-4">
              <button
                onClick={this.handleReset}
                className="w-full bg-content text-white py-5 rounded-2xl font-black text-sm flex items-center justify-center gap-3 hover:bg-black transition-all shadow-xl shadow-slate-200"
              >
                <RefreshCcw size={20} />
                {i18n.t('errors.reload_system')}
              </button>
              
              <button
                onClick={this.handleGoHome}
                className="w-full bg-surface-muted text-content-muted py-5 rounded-2xl font-black text-sm flex items-center justify-center gap-3 hover:bg-surface-muted transition-all border-2 border-border"
              >
                <Home size={20} />
                {i18n.t('errors.back_home')}
              </button>
            </div>

            {eventId && (
               <p className="text-sm text-content-muted mt-6 font-mono">{i18n.t('errors.error_id', { id: eventId })}</p>
            )}

            {import.meta.env.DEV && error && (
              <div className="mt-8 p-4 bg-gray-900 rounded-xl text-left overflow-auto max-h-48 shadow-inner" dir="ltr">
                <div className="flex items-center gap-2 mb-2 text-red-400 border-b border-gray-800 pb-2">
                  <Terminal size={14} />
                  <span className="text-sm font-bold uppercase">Developer Error Log</span>
                </div>
                <p className="text-sm font-mono text-red-300 font-bold mb-2">{error.toString()}</p>
                <pre className="text-sm font-mono text-content-muted whitespace-pre-wrap leading-relaxed">
                  {error.stack}
                </pre>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

