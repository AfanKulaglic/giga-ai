'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { ThemeToggle } from '@/components/providers/theme-provider';
import { Badge, Button, Spinner } from '@/components/ui/primitives';
import { AIKeysPill } from '@/components/ai-keys-pill';
import { AIUsagePill } from '@/components/ai-usage-pill';
import { cn, initials } from '@/lib/utils';
import { Boxes, CloudOff, LogOut, MessagesSquare, ScrollText, Settings2, Sparkles } from 'lucide-react';

const NAV = [
  { href: '/', label: 'Radni prostor', icon: Sparkles },
  { href: '/sessions', label: 'Sesije', icon: MessagesSquare },
  { href: '/products', label: 'Proizvodi', icon: Boxes },
  { href: '/rules', label: 'Pravila', icon: ScrollText },
  { href: '/settings', label: 'Postavke', icon: Settings2 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { ready, mode, authenticated, localMode, user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = React.useState(false);

  const requiresLogin = mode !== 'local';

  React.useEffect(() => {
    if (ready && requiresLogin && !authenticated && pathname !== '/login') {
      router.replace('/login');
    }
  }, [ready, requiresLogin, authenticated, pathname, router]);

  if (pathname === '/login') return <>{children}</>;

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  if (requiresLogin && !authenticated) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        Preusmjeravanje na prijavu…
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b glass">
        <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-3 px-3 sm:px-5">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg pr-1" aria-label="GIGA.ba AI asistent">
            <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-foreground text-[15px] font-bold tracking-[-0.04em] text-background">
              G
            </span>
            <span className="hidden leading-none sm:block">
              <span className="block text-[13px] font-semibold tracking-[-0.01em]">GIGA.ba</span>
              <span className="mt-0.5 block text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                AI asistent
              </span>
            </span>
          </Link>

          <nav className="ml-2 flex items-center gap-0.5">
            {NAV.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors',
                    active
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <AIKeysPill />
            <AIUsagePill />
            {localMode ? (
              <Badge tone="amber" className="hidden sm:inline-flex" title="Firebase nije konfiguriran — podaci se čuvaju lokalno na serveru.">
                <CloudOff className="h-3 w-3" /> Lokalni način
              </Badge>
            ) : (
              <Badge tone="green" className="hidden lg:inline-flex">
                Povezano
              </Badge>
            )}
            <ThemeToggle />
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Korisnički meni"
                className="rounded-full"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-muted text-[11px] font-semibold text-foreground/80">
                  {user?.email ? initials(user.email) : 'L'}
                </span>
              </Button>
              {menuOpen ? (
                <>
                  <button className="fixed inset-0 z-40 cursor-default" onClick={() => setMenuOpen(false)} aria-hidden />
                  <div className="absolute right-0 top-11 z-50 w-60 rounded-xl border bg-background p-1.5 shadow-lift animate-in">
                    <div className="px-2.5 py-2">
                      <p className="text-[12px] font-medium">{user?.email ?? 'Lokalni korisnik'}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {localMode ? 'Bez prijave (privatni alat)' : mode === 'password' ? 'Pristup šifrom' : 'Prijavljeni nalog'}
                      </p>
                    </div>
                    {!localMode ? (
                      <>
                        <div className="my-1 h-px bg-border" />
                        <button
                          onClick={async () => {
                            setMenuOpen(false);
                            await signOut();
                            router.replace('/login');
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-foreground/80 hover:bg-muted"
                        >
                          <LogOut className="h-3.5 w-3.5" /> Odjavi se
                        </button>
                      </>
                    ) : (
                      <div className="px-2.5 pb-2 text-[11px] leading-relaxed text-muted-foreground">
                        Dodajte Firebase kredencijale u <code className="font-mono">.env</code> za prijavu i cloud bazu.
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
