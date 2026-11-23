'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/lib/domain/types';
import { StickyNote, Terminal, Trash2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';

const TYPE_LABEL: Record<ChatMessage['senderType'], string> = {
  customer: 'Kupac',
  agent: 'Vi (poslano)',
  note: 'Interna bilješka',
  instruction: 'Uputa AI-u',
};

export function MessageBubble({
  message,
  compact,
  onDelete,
}: {
  message: ChatMessage;
  compact?: boolean;
  onDelete?: (messageId: string) => void;
}) {
  const [deleting, setDeleting] = React.useState(false);

  const remove = async () => {
    if (!onDelete || deleting) return;
    if (!window.confirm('Obrisati ovu poruku iz razgovora?')) return;
    setDeleting(true);
    try {
      await onDelete(message.id);
    } finally {
      setDeleting(false);
    }
  };

  const deleteButton = onDelete ? (
    <button
      type="button"
      onClick={remove}
      disabled={deleting}
      title="Obriši poruku"
      aria-label="Obriši poruku"
      className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-destructive disabled:opacity-40"
    >
      <Trash2 className="h-3 w-3" />
    </button>
  ) : null;

  const internal = message.senderType === 'note' || message.senderType === 'instruction';
  const isAgent = message.senderType === 'agent';

  if (internal) {
    return (
      <div className="animate-in">
        <div className="mx-auto flex max-w-[92%] items-start gap-2 rounded-xl border border-dashed border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.07)] px-3 py-2">
          {message.senderType === 'note' ? (
            <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--warning))]" />
          ) : (
            <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--warning))]" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--warning))]">
                {TYPE_LABEL[message.senderType]} · nije poslano kupcu
              </p>
              {deleteButton}
            </div>
            <p className="prose-chat mt-0.5 text-[13px] leading-relaxed text-foreground/85">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex animate-in flex-col gap-1', isAgent ? 'items-end' : 'items-start')}>
      <div className="flex items-center gap-1.5 px-1">
        <span className="text-[10.5px] font-medium text-muted-foreground">{TYPE_LABEL[message.senderType]}</span>
        <span className="text-[10px] text-muted-foreground/60">{formatDate(message.createdAt)}</span>
        {deleteButton}
      </div>
      <div
        className={cn(
          'prose-chat max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-[0_1px_1px_rgba(0,0,0,.03)]',
          isAgent
            ? 'rounded-br-md border border-primary/20 bg-primary/[0.09] text-foreground'
            : 'rounded-bl-md border bg-surface text-foreground',
          compact && 'text-[13px]',
        )}
      >
        {message.content}
      </div>
    </div>
  );
}
