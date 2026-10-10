import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface Props {
  to?: string;
  className?: string;
  inverted?: boolean;
}

/** Wortmarke "q-me" mit Q-Marke im Wartemarken-Stil */
export const Logo = ({ to = '/', className, inverted = false }: Props) => (
  <Link to={to} className={cn('flex items-center gap-2.5 rounded-lg', className)} aria-label="q-me – zur Startseite">
    <span
      className={cn(
        'rounded-md px-2 py-1 font-mono text-sm font-bold leading-none',
        inverted ? 'bg-signal text-signal-foreground' : 'bg-foreground text-signal',
      )}
      aria-hidden="true"
    >
      Q
    </span>
    <span className={cn('font-display text-[22px] font-extrabold leading-none tracking-[-0.03em]', inverted && 'text-background')}>
      q-me
    </span>
  </Link>
);
