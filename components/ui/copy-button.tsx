'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, type ButtonProps } from './primitives';
import { copyText } from '@/lib/clipboard';
import { useToast } from './toast';
import { cn } from '@/lib/utils';

export function useCopy() {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | null>(null);

  const copy = React.useCallback(
    async (text: string, label = 'Kopirano u clipboard') => {
      const ok = await copyText(text);
      if (ok) {
        setCopied(true);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1600);
        toast({ title: label, tone: 'success' });
      } else {
        toast({
          title: 'Kopiranje nije uspjelo',
          description: 'Selektirajte tekst ručno i kopirajte (Ctrl+C).',
          tone: 'error',
        });
      }
      return ok;
    },
    [toast],
  );

  React.useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  return { copy, copied };
}

export function CopyButton({
  text,
  label = 'Kopiraj',
  copiedLabel = 'Kopirano',
  toastLabel,
  variant = 'secondary',
  size = 'sm',
  className,
  iconOnly,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  toastLabel?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  iconOnly?: boolean;
}) {
  const { copy, copied } = useCopy();
  const disabled = !text.trim();

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled}
      onClick={() => copy(text, toastLabel ?? `${label} — kopirano`)}
      className={cn(className)}
      title={disabled ? 'Nema sadržaja za kopiranje' : label}
      aria-label={label}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {iconOnly ? null : <span>{copied ? copiedLabel : label}</span>}
    </Button>
  );
}
