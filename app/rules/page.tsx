'use client';

import * as React from 'react';
import { AlertTriangle, ScrollText, Search, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/client/api';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Input, Spinner } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/utils';

interface RuleView {
  id: string;
  title: string;
  date: string | null;
  points: string[];
}

interface RulesResponse {
  path: string;
  exists: boolean;
  updatedAt: string | null;
  rules: RuleView[];
  count: number;
}

/**
 * Read-only overview of docs/pravila-asistenta.md, so the owner can check which
 * rules the assistant currently follows without opening the file.
 */
export default function RulesPage() {
  const [data, setData] = React.useState<RulesResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<RulesResponse>('/api/rules'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const rules = data?.rules ?? [];
  const filtered = query.trim()
    ? rules.filter((rule) => {
        const haystack = `${rule.id} ${rule.title} ${rule.points.join(' ')}`.toLowerCase();
        return haystack.includes(query.trim().toLowerCase());
      })
    : rules;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-1 py-2">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[18px] font-semibold">
            <ScrollText className="h-4.5 w-4.5 text-primary" /> Pravila asistenta
          </h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Ovo su pravila koja asistent trenutno poštuje u svakoj poruci. Samo za pregled — mijenjaju se u fajlu{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[11.5px]">{data?.path ?? 'docs/pravila-asistenta.md'}</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="blue">{data?.count ?? 0} pravila</Badge>
          {data?.updatedAt ? <Badge tone="neutral">izmijenjeno {relativeTime(data.updatedAt)}</Badge> : null}
          <Button variant="ghost" size="sm" onClick={() => void load()} loading={loading}>
            <RefreshCw className="h-3.5 w-3.5" /> Osvježi
          </Button>
        </div>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Traži pravilo (npr. dostava, žig, poštanski broj)…"
          className="pl-8"
        />
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[12.5px] text-muted-foreground">
          <Spinner className="h-4 w-4" /> Učitavanje pravila…
        </div>
      ) : error ? (
        <p className="flex items-start gap-1.5 rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[12px] text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      ) : data && !data.exists ? (
        <EmptyState
          icon={<AlertTriangle className="h-7 w-7" />}
          title="Fajl sa pravilima nije pronađen"
          description={`Očekivana putanja: ${data.path}. Asistent tada radi samo sa osnovnim pravilima.`}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-7 w-7" />}
          title="Nema pravila za taj upit"
          description="Probajte drugu riječ ili obrišite pretragu."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((rule) => (
            <Card key={rule.id}>
              <CardHeader>
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone="blue">{rule.id}</Badge>
                  <CardTitle className="truncate">{rule.title}</CardTitle>
                </div>
                {rule.date ? <span className="shrink-0 text-[11px] text-muted-foreground">{rule.date}</span> : null}
              </CardHeader>
              <CardBody>
                {rule.points.length ? (
                  <ul className="space-y-1.5">
                    {rule.points.map((point, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[12.5px] leading-relaxed">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-muted-foreground">Pravilo nema dodatnih stavki.</p>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <p className="pb-4 text-[11.5px] leading-relaxed text-muted-foreground">
        Pravila su poredana po broju i datumu. Kada se dva pravila razlikuju, važi novije. Novo pravilo uvijek dobija novi broj
        (R15, R16…) i nikada ne briše postojeće.
      </p>
    </div>
  );
}
