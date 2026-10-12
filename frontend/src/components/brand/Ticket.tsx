import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TicketStat {
  label: string;
  value: ReactNode;
}

interface Props {
  number: ReactNode;
  eyebrow?: ReactNode;
  eyebrowRight?: ReactNode;
  stats?: TicketStat[];
  footer?: ReactNode;
  /** Farbe der Stanzlöcher = Hintergrund um das Ticket herum */
  notchClassName?: string;
  size?: 'md' | 'lg';
  className?: string;
}

/** Digitale Wartemarke: große Nummer, Abriss, Kennzahlen */
export const Ticket = ({
  number,
  eyebrow,
  eyebrowRight,
  stats = [],
  footer,
  notchClassName = 'before:bg-background after:bg-background',
  size = 'md',
  className,
}: Props) => (
  <div className={cn('flex flex-col gap-4 rounded-3xl bg-signal px-6 py-6 text-signal-foreground', className)}>
    {(eyebrow || eyebrowRight) && (
      <div className="flex items-start justify-between gap-3 text-xs font-semibold uppercase tracking-[0.08em]">
        <span>{eyebrow}</span>
        {eyebrowRight && <span className="text-right">{eyebrowRight}</span>}
      </div>
    )}
    <div
      className={cn(
        'font-mono font-bold leading-[0.85] tracking-[-0.05em]',
        size === 'lg' ? 'text-[88px] sm:text-[112px]' : 'text-7xl sm:text-[88px]',
      )}
    >
      {number}
    </div>
    {stats.length > 0 && (
      <>
        <div className={cn('ticket-perforation -mx-6 my-1', notchClassName)} aria-hidden="true" />
        <dl className="grid grid-cols-2 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <dt className="text-xs font-semibold uppercase tracking-[0.06em]">{s.label}</dt>
              <dd className="font-mono text-2xl font-bold sm:text-3xl">{s.value}</dd>
            </div>
          ))}
        </dl>
      </>
    )}
    {footer}
  </div>
);
