import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Module-level reactive state for register list & counter
let globalRefreshCounter = 0;
const subscribers = new Set<() => void>();

/**
 * Triggers a global soft-refresh event. This increment the reactive counter 
 * and notifies all mounted listeners (pages, components) to re-run their data queries.
 */
export function triggerGlobalRefresh() {
  globalRefreshCounter += 1;
  subscribers.forEach((callback) => callback());
}

/**
 * Custom hook to subscribe to the global soft refresh counter.
 * Returns the current counter value. When triggerGlobalRefresh() is called,
 * this hook will cause the host component to re-render, inturn triggering any
 * useEffects having this counter as their dependency array.
 */
export function useRefreshCounter() {
  const [counter, setCounter] = useState(globalRefreshCounter);

  useEffect(() => {
    const callback = () => setCounter(globalRefreshCounter);
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  }, []);

  return counter;
}

/**
 * Senior Next.js Architect designed useRouter Hook.
 * Adapts Next.js router conventions (.refresh(), .push(), .replace())
 * seamlessly into the client-side SPA runtime without breaking client-side React State.
 */
export function useRouter() {
  // Safe routing fallback, as some testing/isolated sub-sections may not have react-router context
  let navigate: any = () => {};
  try {
    navigate = useNavigate();
  } catch (e) {
    // react-router context missing, degrade gracefully
  }

  return {
    refresh: () => {
      console.log('[Router] Soft refresh event triggered. Re-fetching active Route data from Supabase...');
      triggerGlobalRefresh();
    },
    push: (path: string) => {
      navigate(path);
    },
    replace: (path: string) => {
      navigate(path, { replace: true });
    },
    back: () => {
      navigate(-1);
    }
  };
}

/**
 * Next.js server-action aligned revalidatePath wrapper.
 * Mimics manual server cache purge within client-component compatible modules.
 */
export function revalidatePath(path: string) {
  console.log(`[Cache Revalidation] revalidatePath called on: ${path}. Invoking global soft refresh.`);
  triggerGlobalRefresh();
}
