import React, { ReactNode } from 'react';

/**
 * The confirm / alert / prompt dialog's backdrop and panel, without the motion
 * library (seen-performance-first-open-login-task.md Phase 2.4): ConfirmProvider
 * sits on the startup path. ConfirmMotionFrame (loaded lazily) gives the same
 * frame the same fade / zoom in and out as before; ConfirmStaticFrame shows it
 * at once, with a CSS enter, while that loads or if it cannot load -- a caller
 * awaiting confirm() always gets its dialog.
 */
export interface ConfirmFrameProps {
  open: boolean;
  dir: 'rtl' | 'ltr';
  onBackdrop: () => void;
  children: ReactNode;
}

export const CONFIRM_BACKDROP_CLASS = 'fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm';
export const CONFIRM_PANEL_CLASS = 'bg-surface rounded-3xl shadow-2xl w-full max-w-sm border border-border p-6 space-y-5 text-center';

export function ConfirmStaticFrame({ open, dir, onBackdrop, children }: ConfirmFrameProps) {
  if (!open) return null;
  return (
    <div className={`seen-enter-fade ${CONFIRM_BACKDROP_CLASS}`} dir={dir} onClick={onBackdrop}>
      <div className={`seen-enter-dialog ${CONFIRM_PANEL_CLASS}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
