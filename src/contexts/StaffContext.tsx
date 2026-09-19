import React, { createContext, useContext, useState, useCallback } from 'react';
import { Staff } from '../types';

interface StaffContextType {
  currentStaff: Staff | null;
  setCurrentStaff: React.Dispatch<React.SetStateAction<Staff | null>>;
}

const StaffContext = createContext<StaffContextType | undefined>(undefined);

const STORAGE_KEY = 'current_staff';

// currentStaff used to be pure in-memory state, reset to null on every full
// page reload -- since App.tsx's showPinLogin gate requires !currentStaff,
// that meant the staff PIN screen reappeared on every refresh, not just
// after an actual logout/lock. sessionStorage (not localStorage) so it
// still clears when the tab/browser actually closes, matching how long a
// POS terminal session should reasonably last. The verify-pin server
// response (server.ts) never includes pin_hash/pin, so this is safe to
// store as-is.
function readCachedStaff(): Staff | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Staff) : null;
  } catch {
    return null;
  }
}

function writeCachedStaff(staff: Staff | null): void {
  try {
    if (staff) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(staff));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // sessionStorage can be unavailable (private browsing, full) -- this
    // cache is a convenience only, never load-bearing.
  }
}

export function StaffProvider({ children }: { children: React.ReactNode }) {
  const [currentStaff, setCurrentStaffState] = useState<Staff | null>(() => readCachedStaff());

  const setCurrentStaff = useCallback<React.Dispatch<React.SetStateAction<Staff | null>>>((value) => {
    setCurrentStaffState(prev => {
      const next = typeof value === 'function' ? (value as (prev: Staff | null) => Staff | null)(prev) : value;
      writeCachedStaff(next);
      return next;
    });
  }, []);

  return (
    <StaffContext.Provider value={{ currentStaff, setCurrentStaff }}>
      {children}
    </StaffContext.Provider>
  );
}

export function useStaff() {
  const context = useContext(StaffContext);
  if (context === undefined) {
    throw new Error('useStaff must be used within a StaffProvider');
  }
  return context;
}
