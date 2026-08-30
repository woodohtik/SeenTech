import React, { useEffect, useRef, useState } from 'react';
import { X, Camera } from 'lucide-react';
import { Html5QrcodeScanner, Html5Qrcode } from 'html5-qrcode';
import { useTranslation } from 'react-i18next';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (decodedText: string) => void;
}

export default function ScannerModal({ isOpen, onClose, onScan }: ScannerModalProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string>('');
  const [manualCode, setManualCode] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      setError('');
      setManualCode('');
      const html5QrCode = new Html5Qrcode("reader");
      scannerRef.current = html5QrCode;
      
      html5QrCode.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 }
        },
        (decodedText) => {
          // Success
          html5QrCode.stop().then(() => {
            onScan(decodedText);
            onClose();
          }).catch(err => {
            console.error("Failed to stop scanner", err);
          });
        },
        (errorMessage) => {
          // Error parsing, usually expected while scanning
        }
      ).catch((err) => {
        setError(t('pos.scanner_error'));
        console.error(err);
      });
    }

    return () => {
      if (scannerRef.current) {
        if (scannerRef.current.isScanning) {
          scannerRef.current.stop().catch(console.error);
        }
      }
    };
  }, [isOpen, onClose, onScan, t]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto font-sans"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('pos.scan_barcode')}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-fade-in relative flex flex-col my-auto text-content"
      >
        <div className="flex items-center justify-between p-4 border-b border-border bg-surface">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center text-brand">
              <Camera size={16} />
            </div>
            <h2 className="text-base font-bold text-content">{t('pos.scan_barcode')}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-muted text-content-muted hover:text-content transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 flex flex-col items-center">
          {error ? (
            <div className="w-full space-y-3">
              <div className="text-danger font-bold text-sm text-center p-4 bg-danger/10 rounded-lg w-full">
                {error}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const code = manualCode.trim();
                  if (!code) return;
                  onScan(code);
                  onClose();
                }}
              >
                <label className="sr-only" htmlFor="scanner-manual-code">{t('pos.manual_barcode_entry')}</label>
                <input
                  id="scanner-manual-code"
                  type="text"
                  autoFocus
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder={t('pos.manual_barcode_placeholder')}
                  className="flex-1 bg-surface-muted border border-border rounded-xl px-3.5 py-2.5 text-sm font-semibold text-content outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand"
                />
                <button
                  type="submit"
                  disabled={!manualCode.trim()}
                  className="px-4 py-2.5 bg-brand text-white rounded-xl font-bold text-sm disabled:opacity-40 transition-all hover:bg-brand/90"
                >
                  {t('pos.manual_barcode_submit')}
                </button>
              </form>
            </div>
          ) : (
            <div id="reader" className="w-full h-full overflow-hidden rounded-xl border border-border bg-black"></div>
          )}
          <p className="text-xs text-content-muted font-semibold mt-4 text-center">
            {t('pos.scanner_hint')}
          </p>
        </div>
      </div>
    </div>
  );
}
