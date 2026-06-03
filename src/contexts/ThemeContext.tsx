import React, { createContext, useContext, useEffect } from 'react';
import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from 'next-themes';

export type ThemeType = 'light' | 'dark' | 'elegant' | 'modern';

interface ThemeContextType {
  theme: ThemeType;
  setTheme: (theme: ThemeType) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider 
      attribute="class" 
      defaultTheme="light" 
      enableSystem={false} 
      themes={['light', 'dark', 'elegant', 'modern']}
    >
      <ThemeValueProvider>{children}</ThemeValueProvider>
    </NextThemesProvider>
  );
}

function ThemeValueProvider({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useNextTheme();

  useEffect(() => {
    const root = window.document.documentElement;
    // Update color-scheme for system UI elements
    if (theme === 'dark') {
      root.style.colorScheme = 'dark';
    } else {
      root.style.colorScheme = 'light';
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme: (theme as ThemeType) || 'light', setTheme: (t) => setTheme(t) }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

