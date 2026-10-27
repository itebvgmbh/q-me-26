import type { ReactNode } from 'react';
import { format, isToday, isTomorrow } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';

/** "Heute", "Morgen" oder "Montag, 19. Oktober" */
export const slotDayLabel = (d: Date) => (isToday(d) ? 'Heute' : isTomorrow(d) ? 'Morgen' : format(d, 'EEEE, d. MMMM', { locale: de }));

/** "09:00 · Morgen" */
export const slotLabel = (d: Date) => `${format(d, 'HH:mm')} · ${slotDayLabel(d)}`;

/** Kleiner Kreisel in der aktuellen Textfarbe */
export const Spinner = ({ className }: { className?: string }) => (
  <span className={cn('inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-e-transparent', className)} aria-hidden="true" />
);

/** Zeile "Spinner + Text" für laufende Suchen */
export const Searching = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cn('inline-flex items-center gap-2', className)}>
    <Spinner />
    {children}
  </span>
);
