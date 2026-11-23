'use client';

import * as React from 'react';
import { AlertTriangle, Check, ExternalLink, Plug } from 'lucide-react';
import { useSettings } from './settings-context';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, SectionHeader, Switch, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { renderSignature } from '@/lib/domain/signature';
import { cn } from '@/lib/utils';

function SaveBar({ onSave, dirty, saving }: { onSave: () => Promise<void>; dirty: boolean; saving: boolean }) {
  const { toast } = useToast();
  return (
    <div className="mt-3 flex items-center justify-between border-t pt-3">
      <span className="text-[11px] text-muted-foreground">{dirty ? 'Nesačuvane izmjene' : 'Sve je sačuvano'}</span>
      <Button
        size="sm"
        variant="primary"
        loading={saving}
        disabled={!dirty}
        onClick={async () => {
          try {
            await onSave();
            toast({ title: 'Postavke su sačuvane' });
          } catch (err) {
            toast({ title: 'Čuvanje nije uspjelo', description: (err as Error).message, tone: 'error' });
          }
        }}
      >
        <Check className="h-3.5 w-3.5" /> Sačuvaj
      </Button>
    </div>
  );
}

export function SignatureSection() {
  const { settings, updateSettings, save, dirty, saving } = useSettings();
  if (!settings) return null;
  const sig = settings.signature;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Potpis firme"
        description="Potpis se automatski dodaje na svaku gotovu poruku kupcu. Ne unosi se u privatne odgovore AI asistenta."
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Podaci potpisa</CardTitle>
            <Badge tone={sig.agentName && sig.companyName ? 'green' : 'amber'}>
              {sig.agentName && sig.companyName ? 'konfigurisano' : 'nedostaje ime agenta'}
            </Badge>
          </CardHeader>
          <CardBody className="space-y-3">
            <Field label="Pozdrav / završna fraza" hint="npr. S poštovanjem,">
              <Input
                value={sig.signOff}
                onChange={(e) =>
                  updateSettings((prev) => ({ ...prev, signature: { ...prev.signature, signOff: e.target.value } }))
                }
              />
            </Field>
            <Field label="Ime i prezime agenta" hint="obavezno za potpis">
              <Input
                value={sig.agentName}
                placeholder="npr. Amina Hodžić"
                onChange={(e) =>
                  updateSettings((prev) => ({ ...prev, signature: { ...prev.signature, agentName: e.target.value } }))
                }
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Naziv firme">
                <Input
                  value={sig.companyName}
                  onChange={(e) =>
                    updateSettings((prev) => ({ ...prev, signature: { ...prev.signature, companyName: e.target.value } }))
                  }
                />
              </Field>
              <Field label="Web adresa" hint="npr. giga.ba">
                <Input
                  value={sig.website}
                  placeholder="giga.ba"
                  onChange={(e) =>
                    updateSettings((prev) => ({ ...prev, signature: { ...prev.signature, website: e.target.value } }))
                  }
                />
              </Field>
            </div>
            <Field label="Šablon potpisa" hint="{signOff} {agentName} {companyName} {website}">
              <Textarea
                rows={4}
                className="font-mono text-[12px]"
                value={sig.template}
                onChange={(e) =>
                  updateSettings((prev) => ({ ...prev, signature: { ...prev.signature, template: e.target.value } }))
                }
              />
            </Field>
            <SaveBar onSave={save} dirty={dirty} saving={saving} />
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Pregled</CardTitle>
            <Badge tone="neutral">kako kupac vidi</Badge>
          </CardHeader>
          <CardBody>
            <div className="rounded-xl border bg-background p-4">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Hvala Vam na interesovanju. Provjerit ćemo dostupnost i javiti Vam se sa potvrdom.
              </p>
              <pre className="prose-chat mt-3 whitespace-pre-wrap font-sans text-[13px] leading-relaxed">
                {renderSignature(sig) || '— potpis nije konfiguriran —'}
              </pre>
            </div>
            {!sig.agentName.trim() || !sig.companyName.trim() ? (
              <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.07)] px-2.5 py-2 text-[11.5px] leading-relaxed text-[hsl(var(--warning))]">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Ime agenta i naziv firme ne mogu se izmišljati — unesite ih ručno da bi potpis bio ispravan.
              </p>
            ) : null}
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Prazni elementi se automatski izostavljaju. AI nikada ne dodaje potpis u privatni odgovor agentu.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

interface AIUsage {
  day: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  limit: number;
  percent: number;
  model: string;
  estimatedCostUsd: number;
}

/** Groq free plan ima 200k tokena dnevno — ovo pokazuje koliko je ostalo. */
function AIUsageCard() {
  const [usage, setUsage] = React.useState<AIUsage | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/ai-usage')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AIUsage | null) => {
        if (!cancelled && data) setUsage(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!usage) return null;
  const remaining = Math.max(0, usage.limit - usage.totalTokens);
  const tone = usage.percent >= 90 ? 'red' : usage.percent >= 60 ? 'amber' : 'green';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Potrošnja AI kredita danas</CardTitle>
        <Badge tone={tone}>{usage.percent}% dnevne kvote</Badge>
      </CardHeader>
      <CardBody className="space-y-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              usage.percent >= 90 ? 'bg-danger' : usage.percent >= 60 ? 'bg-[hsl(var(--warning))]' : 'bg-primary',
            )}
            style={{ width: `${usage.percent}%` }}
          />
        </div>
        <p className="text-[11.5px] text-muted-foreground">
          {usage.calls} poziva · {usage.totalTokens.toLocaleString('bs-BA')} tokena
          {usage.percent >= 100 ? '' : ` od ${usage.limit.toLocaleString('bs-BA')}`} (preostalo{' '}
          {remaining.toLocaleString('bs-BA')}) · {usage.day}
        </p>
        {usage.estimatedCostUsd > 0 ? (
          <p className="text-[11.5px] text-muted-foreground">
            Procjena troška po cijenama provajdera: <strong className="text-foreground">${usage.estimatedCostUsd.toFixed(3)}</strong>{' '}
            (naplaćuje se samo na plaćenom planu)
          </p>
        ) : null}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Kada se dnevna kvota potroši, model vraća grešku 429 dok se limit ne resetuje. Zato se testiranje radi sa najmanjim
          brojem poziva.
        </p>
      </CardBody>
    </Card>
  );
}

export function AISection() {
  const { settings, updateSettings, save, dirty, saving, config } = useSettings();
  if (!settings) return null;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="AI upute"
        description="Dodatne upute se dodaju u kontekst modela. Osnovna pravila tačnosti, sigurnosti i firminog nastupa su zaštićena i ne mogu se ukloniti."
      />
      <Card>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <Plug className="h-3.5 w-3.5 text-muted-foreground" />
            <CardTitle>Veza sa modelom</CardTitle>
          </div>
          <Badge tone={config?.ai ? 'green' : 'red'}>{config?.ai ? 'povezano' : 'ključ nedostaje'}</Badge>
        </CardHeader>
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <dl className="space-y-1.5 text-[12px]">
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted-foreground">Provajder</dt>
              <dd className="font-medium">{config?.aiProviderLabel ?? config?.aiProvider ?? '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted-foreground">Model</dt>
              <dd className="font-mono text-[11.5px]">{config?.aiModel ?? '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted-foreground">Varijabla ključa</dt>
              <dd className="font-mono text-[11.5px]">{config?.aiKeyEnv ?? 'AI_API_KEY'}</dd>
            </div>
          </dl>
          <div className="space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {config?.aiKeyCount && config.aiKeyCount > 1 ? (
              <p>
                Ključeva u rotaciji: <strong>{config.aiKeyCount}</strong> — kad jedan dostigne dnevni
                limit, sljedeći se preuzima automatski.
              </p>
            ) : null}
            {config?.aiFreeTier ? <p>{config.aiFreeTier}</p> : null}
            <p>
              Model se mijenja u <code className="rounded bg-background px-1">.env.local</code>:{' '}
              <code className="rounded bg-background px-1">AI_PROVIDER</code> i{' '}
              <code className="rounded bg-background px-1">AI_MODEL</code>. Potreban je model koji pouzdano podržava pozivanje alatki.
            </p>
            <p className="flex items-center gap-1 text-[11px]">
              <ExternalLink className="h-3 w-3" />
              <a
                href={config?.aiProvider === 'groq' ? 'https://console.groq.com/docs/rate-limits' : 'https://aistudio.google.com/docs/openai'}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline-offset-2 hover:underline"
              >
                Dokumentacija provajdera
              </a>
            </p>
          </div>
        </CardBody>
      </Card>

      <AIUsageCard />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dodatne upute agenta</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <Field label="Upute" hint="primjenjuju se na odgovore i poruke">
              <Textarea
                rows={8}
                placeholder="npr. Uvijek predloži i alternativni proizvod ako traženi nije dostupan. Ne spominji rok dostave bez provjere."
                value={settings.ai.additionalInstructions}
                onChange={(e) =>
                  updateSettings((prev) => ({ ...prev, ai: { ...prev.ai, additionalInstructions: e.target.value } }))
                }
              />
            </Field>
            <Field label="Preferirani stil poruka">
              <select
                value={settings.ai.responseStyle}
                onChange={(e) =>
                  updateSettings((prev) => ({
                    ...prev,
                    ai: { ...prev.ai, responseStyle: e.target.value as 'concise' | 'balanced' | 'detailed' },
                  }))
                }
                className="h-9 w-full rounded-[10px] border border-input bg-background px-3 text-sm"
              >
                <option value="concise">Kratko</option>
                <option value="balanced">Uravnoteženo</option>
                <option value="detailed">Detaljnije</option>
              </select>
            </Field>
            <SaveBar onSave={save} dirty={dirty} saving={saving} />
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Zaštićena osnovna pravila</CardTitle>
            <Badge tone="blue">verzija {settings.ai.protectedRulesVersion}</Badge>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
              {[
                'Nikada ne izmišljaj cijene, dostupnost, specifikacije, rokove ni procedure.',
                'Postojanje u katalogu ne znači da je proizvod na stanju.',
                'Finansijski izračun radi isključivo kalkulator, ne model.',
                'Interni podaci i bilješke ne smiju doći u poruku kupcu.',
                'Sesije su izolovane — podaci se ne miješaju između kupaca.',
                'Nastup je uvijek u imenu firme GIGA.ba.',
                'Ako podatak nedostaje, eksplicitno reci da nije provjeren.',
              ].map((rule) => (
                <li key={rule} className="flex gap-1.5">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  {rule}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
