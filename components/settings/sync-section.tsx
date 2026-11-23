'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Clock, Database, PlayCircle, RefreshCw, XCircle } from 'lucide-react';
import { useSettings } from './settings-context';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, SectionHeader, Spinner } from '@/components/ui/primitives';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { relativeTime } from '@/lib/utils';

const statusTone = {
  idle: 'neutral',
  running: 'blue',
  error: 'red',
} as const;

const runTone = {
  running: 'blue',
  success: 'green',
  partial: 'amber',
  failed: 'red',
} as const;

export function storageLabel(storage: string | undefined): string {
  if (storage === 'rtdb') return 'Realtime Database (cloud)';
  if (storage === 'firestore') return 'Firestore (cloud)';
  return 'Lokalna baza';
}

export function SyncSection() {
  const { scraper, config, runScrape, refreshScraper, loading } = useSettings();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<'test' | 'sync' | 'full' | 'refresh' | null>(null);
  const [confirmFull, setConfirmFull] = React.useState(false);
  const [showErrors, setShowErrors] = React.useState(false);

  const runs = (scraper as unknown as { runs?: import('@/lib/domain/types').ScraperRun[] })?.runs ?? [];

  const run = async (mode: 'test' | 'sync' | 'full') => {
    setBusy(mode);
    try {
      const result = await runScrape(mode);
      toast({
        title:
          mode === 'test'
            ? 'Testni uvoz završen'
            : mode === 'full'
              ? 'Kompletan uvoz završen'
              : 'Sinhronizacija završena',
        description: result.message ?? `Kreirano ${result.run?.productsCreated ?? 0}, ažurirano ${result.run?.productsUpdated ?? 0}, neuspjelo ${result.run?.productsFailed ?? 0}.`,
        tone: result.run?.status === 'failed' ? 'error' : 'success',
      });
      setConfirmFull(false);
    } catch (err) {
      toast({ title: 'Uvoz nije uspio', description: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (loading || !scraper) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  const lastRun = scraper.lastRun ?? runs[0] ?? null;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Katalog i sinhronizacija"
        description="Podaci se preuzimaju sa javnog GIGA.ba kataloga (Shopify products.json). Cijene i dostupnost uvijek dolaze iz izvora — aplikacija ih ne izmišlja."
        action={
          <Button
            size="sm"
            variant="ghost"
            loading={busy === 'refresh'}
            onClick={async () => {
              setBusy('refresh');
              try {
                await refreshScraper();
                toast({ title: 'Status je osvježen' });
              } finally {
                setBusy(null);
              }
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Osvježi status
          </Button>
        }
      />

      {/* Koliko saobraćaja ide prema giga.ba — tvrda granica, ne procjena. */}
      {(scraper as unknown as { siteLoad?: { usedLastHour: number; maxPerHour: number } }).siteLoad ? (
        <div className="rounded-xl border bg-surface px-3 py-2 text-[12px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">Saobraćaj prema giga.ba (zadnjih sat)</span>
            <span className="font-medium tabular-nums">
              {(scraper as unknown as { siteLoad: { usedLastHour: number; maxPerHour: number } }).siteLoad.usedLastHour} /{' '}
              {(scraper as unknown as { siteLoad: { usedLastHour: number; maxPerHour: number } }).siteLoad.maxPerHour} zahtjeva
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Cijeli ciklus kataloga je 10 zahtjeva; provjera uz odgovor najviše 5. Kad se dosegne granica, aplikacija
            prestaje zvati sajt i koristi podatke iz baze.
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            icon: Database,
            label: 'Proizvoda u katalogu',
            value: String(scraper.totalProducts ?? 0),
            note: storageLabel(config?.storage),
          },
          {
            icon: Clock,
            label: 'Zadnja uspješna sinhronizacija',
            value: scraper.lastSuccessfulSyncAt ? relativeTime(scraper.lastSuccessfulSyncAt) : 'nije bilo',
            note: scraper.lastSuccessfulSyncAt ? new Date(scraper.lastSuccessfulSyncAt).toLocaleString('bs-BA') : 'pokrenite uvoz',
          },
          {
            icon: scraper.currentStatus === 'error' ? XCircle : CheckCircle2,
            label: 'Trenutni status',
            value:
              scraper.currentStatus === 'running'
                ? 'u toku'
                : scraper.currentStatus === 'error'
                  ? 'greška'
                  : 'mirno',
            note: `interval ${scraper.intervalMinutes ?? 0} min`,
          },
          {
            icon: AlertTriangle,
            label: 'Zadnji uvoz',
            value: lastRun ? `${lastRun.productsSeen} viđeno` : '—',
            note: lastRun ? `${lastRun.productsFailed} neuspjelo · ${lastRun.productsUpdated} ažurirano` : 'nema zapisa',
          },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border bg-surface p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <stat.icon className="h-3 w-3" /> {stat.label}
            </div>
            <p className="mt-1.5 text-[17px] font-semibold leading-tight">{stat.value}</p>
            <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{stat.note}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Testni uvoz</CardTitle>
            <Badge tone="neutral">10 proizvoda</Badge>
          </CardHeader>
          <CardBody className="space-y-2">
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Siguran prvi korak: provjerava parser i mapiranje polja na malom uzorku bez diranja ostatka kataloga.
            </p>
            <Button size="sm" variant="secondary" loading={busy === 'test'} disabled={Boolean(busy)} onClick={() => run('test')}>
              <PlayCircle className="h-3.5 w-3.5" /> Pokreni test
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sinhronizacija</CardTitle>
            <Badge tone="green">preporučeno</Badge>
          </CardHeader>
          <CardBody className="space-y-2">
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Povlači cijeli katalog i primjenjuje samo stvarne promjene (cijena, dostupnost, specifikacije). Ne mijenja ručne
              specifikacije agenta.
            </p>
            <Button size="sm" variant="primary" loading={busy === 'sync'} disabled={Boolean(busy)} onClick={() => run('sync')}>
              <RefreshCw className="h-3.5 w-3.5" /> Sinhronizuj sada
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kompletan uvoz</CardTitle>
            <Badge tone="amber">duže traje</Badge>
          </CardHeader>
          <CardBody className="space-y-2">
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Prolazi kroz sve stranice kataloga. Koristite za prvo punjenje baze ili nakon većih promjena na sajtu.
            </p>
            <Button size="sm" variant="secondary" loading={busy === 'full'} disabled={Boolean(busy)} onClick={() => setConfirmFull(true)}>
              <Database className="h-3.5 w-3.5" /> Pokreni kompletan uvoz
            </Button>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Historija uvoza</CardTitle>
          <Badge tone={statusTone[scraper.currentStatus]}>status: {scraper.currentStatus}</Badge>
        </CardHeader>
        <CardBody className="p-0">
          {runs.length === 0 ? (
            <p className="px-3.5 py-4 text-[12px] text-muted-foreground">Još nema evidentiranih uvoza.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11.5px]">
                <thead className="border-b bg-muted/40 text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Vrijeme</th>
                    <th className="px-3 py-1.5 font-medium">Način</th>
                    <th className="px-3 py-1.5 font-medium">Status</th>
                    <th className="px-3 py-1.5 font-medium">Viđeno</th>
                    <th className="px-3 py-1.5 font-medium">Novo</th>
                    <th className="px-3 py-1.5 font-medium">Ažurirano</th>
                    <th className="px-3 py-1.5 font-medium">Greške</th>
                    <th className="px-3 py-1.5 font-medium">Trajanje</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {runs.slice(0, 12).map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{relativeTime(r.startedAt)}</td>
                      <td className="px-3 py-1.5">{r.mode}</td>
                      <td className="px-3 py-1.5">
                        <Badge tone={runTone[r.status]}>{r.status}</Badge>
                      </td>
                      <td className="px-3 py-1.5">{r.productsSeen}</td>
                      <td className="px-3 py-1.5">{r.productsCreated}</td>
                      <td className="px-3 py-1.5">{r.productsUpdated}</td>
                      <td className="px-3 py-1.5">{r.productsFailed}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)} s` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {lastRun && lastRun.errors.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Greške zadnjeg uvoza ({lastRun.errors.length})</CardTitle>
            <Button size="sm" variant="ghost" onClick={() => setShowErrors((v) => !v)}>
              {showErrors ? 'Sakrij' : 'Prikaži'}
            </Button>
          </CardHeader>
          {showErrors ? (
            <CardBody className="space-y-1.5">
              {lastRun.errors.slice(0, 20).map((e, i) => (
                <div key={i} className="rounded-lg border border-danger/20 bg-danger/[0.04] px-2.5 py-1.5 text-[11px]">
                  <span className="font-medium text-danger">{e.context ?? 'greška'}</span>
                  <span className="ml-1.5 text-muted-foreground">{e.message}</span>
                </div>
              ))}
              {lastRun.errors.length > 20 ? (
                <p className="text-[10.5px] text-muted-foreground">… i još {lastRun.errors.length - 20}</p>
              ) : null}
            </CardBody>
          ) : null}
        </Card>
      ) : null}

      <div className="rounded-xl border bg-muted/30 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground/80">Automatska sinhronizacija</p>
        <p className="mt-0.5">
          Za redovno osvježavanje pokrenite radnik na serveru: <code className="rounded bg-background px-1">npm run scraper:schedule</code>.
          Interval se podešava varijablom <code className="rounded bg-background px-1">SCRAPER_INTERVAL_MINUTES</code>. Na Vercelu ili
          serverless okruženju koristite eksterni cron koji poziva zaštićenu rutu <code className="rounded bg-background px-1">POST /api/scraper/run</code>.
        </p>
        <p className="mt-1">
          Konfiguracija: <code className="rounded bg-background px-1">{config?.aiKeyEnv ?? 'AI_API_KEY'}</code>,{' '}
          <code className="rounded bg-background px-1">FIREBASE_SERVICE_ACCOUNT</code>,{' '}
          <code className="rounded bg-background px-1">SCRAPER_CRON_SECRET</code>. Vrijednosti se nikada ne prikazuju u aplikaciji.
        </p>
      </div>

      <Dialog open={confirmFull} onOpenChange={setConfirmFull}>
        <DialogContent>
          <DialogHeader
            title="Pokrenuti kompletan uvoz?"
            description="Prolazi kroz cijeli katalog GIGA.ba. Traje duže i šalje više zahtjeva prema sajtu."
          />
          <DialogBody>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Postojeći proizvodi se ažuriraju, novi dodaju. Ručne specifikacije agenta i sve postavke ostaju netaknute.
              Preporuka: pokrenite sinhronizaciju umjesto kompletnog uvoza ako baza već ima proizvode.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmFull(false)}>
              Odustani
            </Button>
            <Button variant="primary" size="sm" loading={busy === 'full'} onClick={() => run('full')}>
              Pokreni uvoz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
