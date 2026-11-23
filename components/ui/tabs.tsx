'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
}

export function Tabs({
  items,
  value,
  onValueChange,
  className,
  size = 'md',
}: {
  items: TabItem[];
  value: string;
  onValueChange: (id: string) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="tablist" className={cn('inline-flex items-center gap-0.5 rounded-xl bg-muted p-0.5', className)}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(item.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[9px] font-medium transition-all duration-150',
              size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
              active
                ? 'bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.icon}
            {item.label}
            {item.badge !== undefined ? (
              <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">{item.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
