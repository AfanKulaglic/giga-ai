'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  wide,
  hideClose,
}: {
  className?: string;
  children: React.ReactNode;
  wide?: boolean;
  hideClose?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[3px] data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border bg-background shadow-lift outline-none data-[state=open]:animate-scale-in',
          wide ? 'max-w-3xl' : 'max-w-lg',
          className,
        )}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Zatvori</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="border-b px-5 py-4 pr-12">
      <DialogPrimitive.Title className="text-[15px] font-semibold tracking-[-0.01em]">{title}</DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          {description}
        </DialogPrimitive.Description>
      ) : null}
    </div>
  );
}

export function DialogBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('max-h-[calc(88vh-9rem)] overflow-y-auto px-5 py-4', className)}>{children}</div>;
}

export function DialogFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex items-center justify-end gap-2 border-t bg-surface px-5 py-3', className)}>{children}</div>;
}
