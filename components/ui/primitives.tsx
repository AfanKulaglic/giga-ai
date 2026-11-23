'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

// ---------------------------------- Button ---------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'link';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-foreground hover:brightness-110 active:brightness-95 shadow-[0_1px_2px_rgba(0,0,0,.12)]',
  secondary:
    'bg-background text-foreground border border-input hover:bg-muted/60 active:bg-muted',
  ghost: 'text-foreground/80 hover:bg-muted hover:text-foreground',
  subtle: 'bg-muted text-foreground/90 hover:bg-muted/70',
  danger: 'bg-danger text-white hover:brightness-110',
  link: 'text-primary underline-offset-4 hover:underline p-0 h-auto',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-[10px]',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
  icon: 'h-9 w-9 rounded-[10px] justify-center',
  'icon-sm': 'h-7 w-7 rounded-lg justify-center',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[filter,background-color,color,opacity,transform] duration-150 disabled:pointer-events-none disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

// ---------------------------------- Inputs ---------------------------------

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-9 w-full rounded-[10px] border border-input bg-background px-3 text-sm text-foreground shadow-[inset_0_1px_0_rgba(0,0,0,.02)] placeholder:text-muted-foreground/70 transition-colors focus-visible:border-ring/60 disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full resize-none rounded-[10px] border border-input bg-background px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/70 transition-colors focus-visible:border-ring/60 disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'h-9 w-full appearance-none rounded-[10px] border border-input bg-background px-3 pr-8 text-sm text-foreground transition-colors focus-visible:border-ring/60',
          "bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")] bg-[right_0.65rem_center] bg-no-repeat",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-[13px] font-medium text-foreground/85', className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}

// ---------------------------------- Surface --------------------------------

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('panel', className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-start justify-between gap-3 px-4 pt-3.5 pb-2', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-[13px] font-semibold tracking-[-0.01em] text-foreground', className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 pb-4', className)} {...props} />;
}

// ---------------------------------- Badge ----------------------------------

type BadgeTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'violet';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-muted-foreground border-transparent',
  blue: 'bg-primary/10 text-primary border-primary/15',
  green: 'bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.2)]',
  amber: 'bg-[hsl(var(--warning)/0.14)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.22)]',
  red: 'bg-[hsl(var(--danger)/0.12)] text-[hsl(var(--danger))] border-[hsl(var(--danger)/0.2)]',
  violet: 'bg-[#7c5cff]/10 text-[#7c5cff] border-[#7c5cff]/20',
};

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[11px] font-medium leading-4',
        badgeTones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Dot({ tone = 'neutral' }: { tone?: 'green' | 'amber' | 'red' | 'neutral' | 'blue' }) {
  const color =
    tone === 'green'
      ? 'bg-[hsl(var(--success))]'
      : tone === 'amber'
        ? 'bg-[hsl(var(--warning))]'
        : tone === 'red'
          ? 'bg-[hsl(var(--danger))]'
          : tone === 'blue'
            ? 'bg-primary'
            : 'bg-muted-foreground/50';
  return <span className={cn('inline-block h-1.5 w-1.5 rounded-full', color)} />;
}

// --------------------------------- Switch ----------------------------------

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors duration-200 disabled:opacity-50',
        checked ? 'border-primary bg-primary' : 'border-input bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

// -------------------------------- Feedback ---------------------------------

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-muted-foreground', className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      {icon ? <div className="mb-1 text-muted-foreground/60">{icon}</div> : null}
      <p className="text-sm font-medium text-foreground/90">{title}</p>
      {description ? <p className="max-w-xs text-[12.5px] leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div>
        <h2 className="text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>
        {description ? <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}
