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
  size?: 'md' | 'lg';
  className?: string;
}

/**
 * Digitale Wartemarke: große Nummer, Abriss, Kennzahlen.
 * Die zwei Stanzlöcher am Abriss sind wirklich ausgestanzt (Masken .ticket-oben/.ticket-unten in index.css): Dort scheint
 * durch, was dahinter liegt – Seite, Karte, Schatten. Schatten deshalb als drop-shadow, der folgt den Löchern; ein
 * box-shadow läge als Rechteck dahinter.
 */
export const Ticket = ({ number, eyebrow, eyebrowRight, stats = [], footer, size = 'md', className }: Props) => {
  const kopf = (
    <>
      {(eyebrow || eyebrowRight) && (
        <div className="flex items-start justify-between gap-3 text-xs font-semibold uppercase tracking-[0.08em]">
          <span>{eyebrow}</span>
          {eyebrowRight && <span className="text-end">{eyebrowRight}</span>}
        </div>
      )}
      <div
        className={cn(
          'font-mono font-bold leading-[0.85] tracking-[-0.05em]',
          size === 'lg' ? 'text-[88px] sm:text-[112px]' : 'text-7xl sm:text-[88px]',
        )}
      >
        {/* bdi: Nummer bleibt auch in arabischer Umgebung in ihrer Reihenfolge */}
        <bdi>{number}</bdi>
      </div>
    </>
  );

  if (stats.length === 0) {
    return (
      <div className={cn('flex flex-col gap-4 rounded-3xl bg-signal px-6 py-6 text-signal-foreground', className)}>
        {kopf}
        {footer}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col text-signal-foreground', className)}>
      <div className="ticket-oben flex flex-col gap-4 rounded-t-3xl bg-signal px-6 pb-5 pt-6">{kopf}</div>
      <div className="ticket-unten flex flex-col gap-4 rounded-b-3xl bg-signal px-6 pb-6 pt-5">
        <dl className="grid grid-cols-2 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <dt className="text-xs font-semibold uppercase tracking-[0.06em]">{s.label}</dt>
              <dd className="font-mono text-2xl font-bold sm:text-3xl">{s.value}</dd>
            </div>
          ))}
        </dl>
        {footer}
      </div>
    </div>
  );
};
