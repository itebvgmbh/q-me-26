import { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ShellProps {
  title: string;
  description?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  children: ReactNode;
}

/** Rahmen für einen Schritt der Warteschlange */
export const QueueStepShell = ({ title, description, onBack, backLabel = 'Zurück', children }: ShellProps) => (
  <section className="flex flex-col gap-5 rounded-3xl border border-border bg-card p-5 sm:p-7" aria-labelledby="schritt-titel">
    <div className="flex flex-col gap-1">
      <h2 id="schritt-titel" className="font-display text-2xl font-bold sm:text-3xl">{title}</h2>
      {description && <p className="text-muted-foreground">{description}</p>}
    </div>
    {children}
    {onBack && (
      <Button variant="ghost" className="self-start" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {backLabel}
      </Button>
    )}
  </section>
);

interface OptionProps {
  selected?: boolean;
  onClick: () => void;
  title: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
}

/** Große, tippbare Auswahlzeile */
export const QueueOption = ({ selected = false, onClick, title, meta, badge }: OptionProps) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onClick}
    className={cn(
      'flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
      selected ? 'border-foreground bg-foreground text-background' : 'border-border bg-background hover:border-foreground',
    )}
  >
    <span className="flex min-w-0 flex-col">
      <span className="font-semibold">{title}</span>
      {meta && <span className={cn('text-sm', selected ? 'text-background/75' : 'text-muted-foreground')}>{meta}</span>}
    </span>
    {badge}
  </button>
);
