'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/primitives';

type Theme = 'light' | 'dark';

const ThemeContext = React.createContext<{ theme: Theme; toggle: () => void } | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<Theme>('light');

  React.useEffect(() => {
    const stored = window.localStorage.getItem('giga-theme') as Theme | null;
    const initial = stored ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(initial);
    document.documentElement.classList.toggle('dark', initial === 'dark');
  }, []);

  const toggle = React.useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      window.localStorage.setItem('giga-theme', next);
      return next;
    });
  }, []);

  const value = React.useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function ThemeToggle() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) return null;
  return (
    <Button variant="ghost" size="icon" onClick={ctx.toggle} aria-label="Promijeni temu" title="Svijetla / tamna tema">
      {ctx.theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
