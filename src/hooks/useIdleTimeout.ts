import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tracks user activity (mousemove/keydown/scroll) to trigger an idle
 * timeout, without ever re-rendering or re-attaching window listeners on
 * every such event. Activity timestamps live in a ref, read by a single
 * periodic interval -- not React state in the effect's dependency array.
 *
 * The previous inline version (SaaSLayout.tsx) kept lastActivity in
 * useState and listed it as the effect's dependency, so every single
 * mousemove tore down and recreated the window listeners + interval and
 * forced a full re-render of the layout -- confirmed live on staging to
 * freeze the tab after a few dozen rapid mousemove events.
 */
export function useIdleTimeout(timeoutMs: number, warningLeadMs: number, onTimeout: () => void) {
  const lastActivityRef = useRef(Date.now());
  const [showWarning, setShowWarning] = useState(false);

  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  });

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowWarning(false);
  }, []);

  useEffect(() => {
    const handleActivity = () => resetActivity();
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('scroll', handleActivity);

    // Checked more often than the warning window itself, so a 15s-granularity
    // poll can never skip straight from "no warning" to "logged out".
    const interval = setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current;
      if (idleFor > timeoutMs) {
        onTimeoutRef.current();
      } else if (idleFor > timeoutMs - warningLeadMs) {
        setShowWarning(true);
      }
    }, 15000);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      clearInterval(interval);
    };
  }, [timeoutMs, warningLeadMs, resetActivity]);

  return { showWarning, resetActivity };
}
