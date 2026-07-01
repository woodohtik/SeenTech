import React, { Component, ErrorInfo } from 'react';
import { AlertCircle, RefreshCcw, Home, Terminal } from 'lucide-react';
import { logError } from '../lib/logger';

interface ErrorBoundaryProps {
  children?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  eventId: string | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
    eventId: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidMount() {
    window.addEventListener('unhandledrejection', this.handlePromiseRejection);
    window.addEventListener('error', this.handleGlobalError);
  }

  componentWillUnmount() {
    window.removeEventListener('unhandledrejection', this.handlePromiseRejection);
    window.removeEventListener('error', this.handleGlobalError);
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
    console.error('React ErrorBoundary caught an error:', error, errorInfo);
    try {
      const eventId = new Date().getTime().toString();
      this.setState({ errorInfo, eventId });
      logError(error, { errorInfo, source: 'ErrorBoundary', eventId });
    } catch(e) {
      console.error('Failed to log error inside ErrorBoundary:', e);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, eventId: null });
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, eventId: null });
    window.location.href = '/';
  };

  render() {
    const { hasError, error, eventId } = this.state;
    if (hasError) {
      let errorMessage = "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.";
      let isPermissionError = false;
      let pathInfo = "";

      try {
        if (error?.message) {
          // Check if it's our stringified FirestoreErrorInfo
          const parsed = JSON.parse(error.message);
          
          if (parsed.error && (
            parsed.error.includes('permission-denied') || 
            parsed.error.includes('Missing or insufficient permissions') ||
            parsed.error.includes('insufficient permissions')
          )) {
            errorMessage = "عذراً، ليس لديك الصلاحيات الكافية للوصول إلى هذا الجزء من النظام. قد يكون حسابك غير مفعل أو تم تغيير صلاحياتك.";
            isPermissionError = true;
            if (parsed.path) pathInfo = `المسار: ${parsed.path}`;
          } else if (parsed.error && parsed.error.includes('offline')) {
            errorMessage = "يبدو أنك غير متصل بالإنترنت حالياً. يرجى التأكد من اتصالك والمحاولة مرة أخرى.";
          }
        }
      } catch (e) {
        // Not JSON or parsing failed
        if (error?.message?.toLowerCase().includes('fetch') || error?.message?.toLowerCase().includes('network')) {
           errorMessage = "مشكلة في الاتصال بالشبكة. يرجى التحقق من اتصال الإنترنت وحاول مرة أخرى.";
        }
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sansSelection" dir="rtl">
          <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 p-10 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-red-500 to-rose-500"></div>
            
            <div className="w-24 h-24 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-8 animate-pulse">
              <AlertCircle className="text-rose-500" size={48} />
            </div>
            
            <h1 className="text-2xl font-black text-gray-900 mb-2">
              {isPermissionError ? "خطأ في الصلاحيات" : "عذراً، حدث خطأ ما"}
            </h1>
            
            <p className="text-slate-500 font-bold mb-8 leading-relaxed">
              {errorMessage}
              {pathInfo && <span className="block text-[10px] mt-2 text-slate-400 font-mono" dir="ltr">{pathInfo}</span>}
            </p>

            <div className="space-y-4">
              <button
                onClick={this.handleReset}
                className="w-full bg-slate-900 text-white py-5 rounded-2xl font-black text-sm flex items-center justify-center gap-3 hover:bg-black transition-all shadow-xl shadow-slate-200"
              >
                <RefreshCcw size={20} />
                تحديث النظام
              </button>
              
              <button
                onClick={this.handleGoHome}
                className="w-full bg-slate-50 text-slate-600 py-5 rounded-2xl font-black text-sm flex items-center justify-center gap-3 hover:bg-slate-100 transition-all border-2 border-slate-100"
              >
                <Home size={20} />
                العودة للرئيسية
              </button>
            </div>

            {eventId && (
               <p className="text-xs text-gray-400 mt-6 font-mono">معرف الخطأ: {eventId}</p>
            )}

            {import.meta.env.DEV && error && (
              <div className="mt-8 p-4 bg-gray-900 rounded-xl text-left overflow-auto max-h-48 shadow-inner" dir="ltr">
                <div className="flex items-center gap-2 mb-2 text-red-400 border-b border-gray-800 pb-2">
                  <Terminal size={14} />
                  <span className="text-xs font-bold uppercase tracking-wider">Developer Error Log</span>
                </div>
                <p className="text-xs font-mono text-red-300 font-bold mb-2">{error.toString()}</p>
                <pre className="text-[10px] font-mono text-gray-400 whitespace-pre-wrap leading-relaxed">
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

