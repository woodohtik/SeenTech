import React, { createContext, useContext, useState } from 'react';
import { Staff } from '../types';

interface StaffContextType {
  currentStaff: Staff | null;
  setCurrentStaff: (staff: Staff | null) => void;
}

const StaffContext = createContext<StaffContextType | undefined>(undefined);

export function StaffProvider({ children }: { children: React.ReactNode }) {
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);

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
