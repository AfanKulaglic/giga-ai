'use client';

import * as React from 'react';
import { AlertTriangle, Check, Copy, CornerDownLeft, Edit3, History, Minus, Plus, RefreshCw, Sparkles, X } from 'lucide-react';
import type { GeneratedReply } from '@/lib/domain/types';
import { Badge, Button, Textarea } from '@/components/ui/primitives';
import { CopyButton, useCopy } from '@/components/ui/copy-button';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from './workspace-context';
import { cn } from '@/lib/utils';

export function ReplyDraftCard({
  replies,
  onGenerate,
  busy,
  aiConfigured,
  signatureConfigured,
}: {
  replies: GeneratedReply[];
  onGenerate: (tone: 'concise' | 'balanced' | 'detailed') => Promise<void>;
  busy: boolean;
  aiConfigured: boolean;
  signatureConfigured: boolean;
}) {
  const { editReply, sendMessage, detail, bootstrap } = useWorkspace();
  const { toast } = useToast();
  const { copy } = useCopy();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);

  const latest = replies[replies.length - 1] ?? null;
  const previous = replies.slice(0, -1).reverse();

  React.useEffect(() => {
    if (latest) setDraft(latest.body);
    setEditing(false);
  }, [latest?.id]);

  if (!latest) {
    return (
      <div className="rounded-xl border border-dashed bg-surface/40 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-muted-foreground" />
            <p className="text-[12px] text-muted-foreground">Nema nacrta</p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onGenerate('balanced')}
            loading={busy}
            disabled={!aiConfigured}
            title={!aiConfigured ? 'AI nije konfiguriran' : 'Generiši poruku kupcu'}
          >
            <Sparkles className="h-3 w-3" /> Predloži odgovor
          </Button>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {aiConfigured
            ? 'AI sastavlja gotovu poruku u imenu firme, sa potpisom. Odvojeno je od privatnog razgovora.'
            : `AI nije konfiguriran — dodajte ${bootstrap?.config.aiKeyEnv ?? 'AI_API_KEY'} u .env.local i restartujte aplikaciju.`}
        </p>
      </div>
    );
  }

  const saveEdit = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await editReply(latest.id, draft.trim());
      setEditing(false);
      toast({ title: 'Nacrt je sačuvan' });
    } catch (err) {
      toast({ title: 'Izmjena nije sačuvana', description: (err as Error).message, tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-surface">
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1">
        {latest.editedByAgent ? (
          <span className="text-[10.5px] font-medium text-muted-foreground">uređeno</span>
        ) : null}
        {!latest.signatureApplied ? (
          <Badge tone="amber">
            <AlertTriangle className="h-3 w-3" /> bez potpisa
          </Badge>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5">
          {previous.length ? (
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => setShowHistory((v) => !v)}>
              <History className="h-3 w-3" /> {previous.length}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6"
            onClick={() => onGenerate('concise')}
            loading={busy}
            disabled={!aiConfigured}
            title="Kraća poruka"
            aria-label="Kraća poruka"
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6"
            onClick={() => onGenerate('detailed')}
            loading={busy}
            disabled={!aiConfigured}
            title="Detaljnija poruka"
            aria-label="Detaljnija poruka"
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6"
            onClick={() => onGenerate('balanced')}
            loading={busy}
            disabled={!aiConfigured}
            title="Novi nacrt"
            aria-label="Novi nacrt"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {showHistory && previous.length ? (
        <div className="max-h-32 space-y-1 overflow-y-auto border-b border-primary/15 bg-background/60 px-2 py-1.5">
          {previous.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-2 rounded-lg px-1.5 py-1 hover:bg-muted/50">
              <p className="prose-chat max-h-16 overflow-hidden text-[11.5px] text-muted-foreground">{r.body}</p>
              <CopyButton text={r.fullText} label="Kopiraj" size="sm" variant="ghost" iconOnly />
            </div>
          ))}
        </div>
      ) : null}

      <div className="px-3 py-2">
        {editing ? (
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            className="max-h-52 text-[13px]"
          />
        ) : (
          <p className="prose-chat max-h-56 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed">{latest.fullText}</p>
        )}

        {!signatureConfigured ? (
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-[hsl(var(--warning))]">
            <AlertTriangle className="h-3 w-3" /> Potpis nije konfiguriran — Postavke → Potpis.
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {editing ? (
            <>
              <Button size="sm" variant="primary" onClick={saveEdit} loading={saving} disabled={!draft.trim()}>
                <Check className="h-3.5 w-3.5" /> Sačuvaj
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(latest.body); }}>
                <X className="h-3.5 w-3.5" /> Otkaži
              </Button>
            </>
          ) : (
            <>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Kopiraj poruku"
                title="Kopiraj poruku"
                onClick={() => copy(latest.fullText, 'Poruka je kopirana — spremna za slanje')}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Uredi poruku" title="Uredi" onClick={() => setEditing(true)}>
                <Edit3 className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Označi kao poslano"
                title="Označi kao poslano"
                onClick={async () => {
                  if (!detail) return;
                  try {
                    await sendMessage(latest.fullText, 'agent');
                    toast({ title: 'Poruka je zabilježena kao poslana' });
                  } catch (err) {
                    toast({ title: 'Nije zabilježeno', description: (err as Error).message, tone: 'error' });
                  }
                }}
              >
                <CornerDownLeft className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {latest.citations.length ? (
            <span className="ml-auto text-[10.5px] text-muted-foreground">
              izvori: {latest.citations.slice(0, 2).map((c) => c.label).join(', ')}
              {latest.citations.length > 2 ? ` +${latest.citations.length - 2}` : ''}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
