'use client';

import * as React from 'react';
import { watchAuth, signIn as fbSignIn, signOut as fbSignOut, firebaseClientConfigured } from '@/lib/client/firebase';
import { setTokenProvider } from '@/lib/client/api';

type AuthMode = 'local' | 'password' | 'firebase';

interface AuthState {
  ready: boolean;
  mode: AuthMode;
  authenticated: boolean;
  user: { uid: string; email: string | null } | null;
  /** true when no gate at all is configured (private single-user machine). */
  localMode: boolean;
  passwordMode: boolean;
  firebaseConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithPassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthState | null>(null);

const LOCAL_USER = { uid: 'local-user', email: 'agent@local' };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const [mode, setMode] = React.useState<AuthMode>('local');
  const [authenticated, setAuthenticated] = React.useState(false);
  const [fbUser, setFbUser] = React.useState<AuthState['user']>(null);

  // Which gate is active is decided by the server (AUTH_MODE).
  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { mode?: AuthMode; authenticated?: boolean } | null) => {
        if (cancelled) return;
        const nextMode = data?.mode ?? 'local';
        setMode(nextMode);
        setAuthenticated(nextMode === 'local' ? true : Boolean(data?.authenticated));
        if (nextMode !== 'firebase') setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setMode('local');
        setAuthenticated(true);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Firebase accounts, only when the operator chose that mode.
  const firebaseActive = mode === 'firebase' && firebaseClientConfigured;

  React.useEffect(() => {
    if (mode !== 'firebase') {
      setTokenProvider(async () => null);
      return;
    }
    if (!firebaseActive) {
      setTokenProvider(async () => null);
      setReady(true);
      return;
    }
    const unsubscribe = watchAuth((user) => {
      setFbUser(user ? { uid: user.uid, email: user.email } : null);
      setAuthenticated(Boolean(user));
      setTokenProvider(user ? () => user.getIdToken() : async () => null);
      setReady(true);
    });
    return unsubscribe;
  }, [mode, firebaseActive]);

  const value = React.useMemo<AuthState>(
    () => ({
      ready,
      mode,
      authenticated,
      user: mode === 'firebase' ? fbUser : authenticated ? LOCAL_USER : null,
      localMode: mode === 'local',
      passwordMode: mode === 'password',
      firebaseConfigured: firebaseActive,
      signIn: async (email, password) => {
        await fbSignIn(email, password);
      },
      signInWithPassword: async (password) => {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? 'Prijava nije uspjela.');
        }
        setAuthenticated(true);
      },
      signOut: async () => {
        if (mode === 'firebase') {
          await fbSignOut();
          return;
        }
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
        setAuthenticated(false);
      },
    }),
    [ready, mode, authenticated, fbUser, firebaseActive],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth mora biti unutar AuthProvider.');
  return ctx;
}
