'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { Button, Field, Input } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

export default function LoginPage() {
  const { firebaseConfigured, passwordMode, authenticated, signIn, signInWithPassword } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (authenticated) router.replace('/');
  }, [authenticated, router]);

  if (passwordMode) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface px-4">
        <form
          className="w-full max-w-sm rounded-2xl border bg-background p-6 shadow-soft"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await signInWithPassword(password);
              toast({ title: 'Dobro došli' });
              router.replace('/');
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Pogrešna šifra.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="mb-5 flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-foreground text-[15px] font-bold text-background">G</span>
            <div>
              <h1 className="text-[15px] font-semibold tracking-[-0.01em]">GIGA.ba AI asistent</h1>
              <p className="text-[11px] text-muted-foreground">Unesite šifru za pristup</p>
            </div>
          </div>

          <div className="space-y-3">
            <Field label="Šifra" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••"
              />
            </Field>
            {error ? <p className="text-[12px] text-danger">{error}</p> : null}
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              <LockKeyhole className="h-4 w-4" /> Otvori radni prostor
            </Button>
          </div>
        </form>
      </div>
    );
  }

  if (!firebaseConfigured) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface px-4">
        <div className="w-full max-w-md rounded-2xl border bg-background p-6 shadow-soft">
          <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-foreground text-background">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h1 className="text-[18px] font-semibold tracking-[-0.02em]">Lokalni način rada</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Firebase nije konfiguriran, pa se aplikacija pokreće kao privatni alat jednog korisnika. Podaci se čuvaju na
            serveru u lokalnoj bazi (<code className="font-mono">.data/db.json</code>).
          </p>
          <p className="mt-2 rounded-lg border bg-surface px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
            Za prijavu i Cloud Firestore dodajte <code className="font-mono">NEXT_PUBLIC_FIREBASE_*</code> i{' '}
            <code className="font-mono">FIREBASE_*</code> varijable u <code className="font-mono">.env</code>.
          </p>
          <Button className="mt-4 w-full" variant="primary" onClick={() => router.replace('/')}>
            Nastavi u radni prostor <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface px-4">
      <form
        className="w-full max-w-sm rounded-2xl border bg-background p-6 shadow-soft"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await signIn(email.trim(), password);
            toast({ title: 'Prijava uspješna' });
            router.replace('/');
          } catch {
            setError('Prijava nije uspjela. Provjerite email i lozinku.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="mb-5 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-foreground text-[15px] font-bold text-background">G</span>
          <div>
            <h1 className="text-[15px] font-semibold tracking-[-0.01em]">GIGA.ba AI asistent</h1>
            <p className="text-[11px] text-muted-foreground">Privatni alat prodajnog agenta</p>
          </div>
        </div>

        <div className="space-y-3">
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Lozinka" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error ? <p className="text-[12px] text-danger">{error}</p> : null}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            <LockKeyhole className="h-4 w-4" /> Prijavi se
          </Button>
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          Pristup imaju samo nalozi navedeni u <code className="font-mono">AUTHORIZED_EMAILS</code>.
        </p>
      </form>
    </div>
  );
}
