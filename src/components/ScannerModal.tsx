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
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError('');
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
        setError(t('pos.scanner_error', 'حدث خطأ أثناء تشغيل الكاميرا. يرجى التحقق من الصلاحيات.'));
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto font-sans">
      <div className="bg-surface border border-border w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-fade-in relative flex flex-col my-auto text-content">
        <div className="flex items-center justify-between p-4 border-b border-border bg-surface">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center text-brand">
              <Camera size={16} />
            </div>
            <h2 className="text-base font-bold text-content">{t('pos.scan_barcode', 'مسح الباركود')}</h2>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-muted text-content-muted hover:text-content transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 flex flex-col items-center">
          {error ? (
            <div className="text-danger font-bold text-sm text-center p-4 bg-danger/10 rounded-lg w-full">
              {error}
            </div>
          ) : (
            <div id="reader" className="w-full h-full overflow-hidden rounded-xl border border-border bg-black"></div>
          )}
          <p className="text-xs text-content-muted font-semibold mt-4 text-center">
            {t('pos.scanner_hint', 'وجه الكاميرا نحو الباركود للمسح التلقائي.')}
          </p>
        </div>
      </div>
    </div>
  );
}
