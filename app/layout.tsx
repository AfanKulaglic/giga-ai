import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { AuthProvider } from '@/components/providers/auth-provider';
import { ToastProvider } from '@/components/ui/toast';
import { AppShell } from '@/components/app-shell';

export const metadata: Metadata = {
  title: 'GIGA.ba — AI asistent prodaje',
  description: 'Privatni radni asistent internet prodajnog agenta GIGA.ba.',
  applicationName: 'GIGA AI asistent',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#11151c' },
  ],
};

function initTheme() {
  const stored = window.localStorage.getItem('giga-theme');
  const theme = stored ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bs" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(${initTheme.toString()})()` }} />
      </head>
      <body className="min-h-dvh">
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <AppShell>{children}</AppShell>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}