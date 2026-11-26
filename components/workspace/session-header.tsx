'use client';

import * as React from 'react';
import { Check, RotateCcw, UserRound, X } from 'lucide-react';
import { useWorkspace } from './workspace-context';
import { QuickRepliesBar } from './quick-replies';
import { Button, Input } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { relativeTime } from '@/lib/utils';

/**
 * Jedan razgovor, bez historije.
 *
 * Agent radi jednu mušteriju u jednom trenutku. Zato nema liste sesija: postoji
 * samo trenutni razgovor i dugme „Reset” koje ga trajno briše i otvara prazan —
 * isto kao da je kliknuo „nova sesija”, samo bez hrpe starih sesija u bazi.
 */
export function SessionHeader() {
  const { sessions, activeSessionId, detail, resetWorkspace, renameSession } = useWorkspace();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [label, setLabel] = React.useState('');
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);

  const active = detail?.session ?? sessions.find((s) => s.id === activeSessionId) ?? null;

  React.useEffect(() => {
    if (active) setLabel(active.label);
  }, [active?.id, active?.label]);

  const doReset = async () => {
    setResetting(true);
    try {
      await resetWorkspace();
      setConfirmReset(false);
      toast({ title: 'Razgovor je resetovan', description: 'Stari razgovor je obrisan, počinjete prazan.', tone: 'success' });
    } catch (err) {
      toast({ title: 'Reset nije uspio', description: (err as Error).message, tone: 'error' });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="border-b bg-background/80 px-3 py-2 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        {active ? (
          editing ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <Input
                autoFocus
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && label.trim()) {
                    await renameSession(label.trim());
                    setEditing(false);
                  }
                  if (e.key === 'Escape') setEditing(false);
                }}
                className="h-9 w-[240px]"
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Sačuvaj naziv"
                onClick={async () => {
                  if (label.trim()) await renameSession(label.trim());
                  setEditing(false);
                }}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Otkaži" onClick={() => setEditing(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              title="Preimenuj razgovor"
              className="flex min-w-0 items-center gap-2 rounded-xl border bg-surface px-3 py-1.5 text-left transition-colors hover:border-primary/30"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                <UserRound className="h-3.5 w-3.5" />
              </span>
              <span className="truncate text-[13px] font-medium">{active.label}</span>
            </button>
          )
        ) : (
          <span className="text-[13px] text-muted-foreground">Nema razgovora — pritisnite Reset.</span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {active ? (
            <span className="hidden text-[11.5px] text-muted-foreground sm:inline">
              zadnja aktivnost {relativeTime(active.lastMessageAt ?? active.updatedAt)}
            </span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 rounded-lg px-2.5 text-[12px]"
            onClick={() => setConfirmReset(true)}
            title="Obriši trenutni razgovor i počni prazan"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
        </div>
      </div>

      <QuickRepliesBar />

      <Dialog open={confirmReset} onOpenChange={(open) => !open && setConfirmReset(false)}>
        <DialogContent>
          <DialogHeader
            title="Resetovati razgovor?"
            description="Trenutni razgovor (poruke, proizvodi u sesiji i nacrti) se trajno briše i otvara se prazan. Ova radnja se ne može poništiti."
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
              Odustani
            </Button>
            <Button variant="danger" size="sm" loading={resetting} onClick={doReset}>
              Resetuj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
