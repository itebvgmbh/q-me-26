import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface Props {
  to?: string;
  className?: string;
  inverted?: boolean;
}

/** Wartemarke mit Kerben und Perforation – das Zeichen von Dranzeit (gleiche Form wie favicon.svg) */
export const BrandMark = ({ inverted = false, className }: { inverted?: boolean; className?: string }) => (
  <span
    className={cn(
      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
      inverted ? 'bg-signal text-signal-foreground' : 'bg-foreground text-signal',
      className,
    )}
    aria-hidden="true"
  >
    <svg viewBox="0 0 24 24" className="h-[19px] w-[19px]">
      <path
        fill="currentColor"
        d="M4 6h16a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5V8a2 2 0 0 1 2-2z"
      />
      <path
        d="M6.5 12h11"
        strokeWidth="1.6"
        strokeDasharray="2 1.6"
        className={inverted ? 'stroke-signal' : 'stroke-foreground'}
      />
    </svg>
  </span>
);

/** Wortmarke "Dranzeit" mit Wartemarke */
export const Logo = ({ to = '/', className, inverted = false }: Props) => (
  <Link to={to} className={cn('flex min-h-11 items-center gap-2.5 rounded-lg', className)} aria-label="Dranzeit – zur Startseite">
    <BrandMark inverted={inverted} />
    <span className={cn('font-display text-[22px] font-extrabold leading-none tracking-[-0.03em]', inverted && 'text-background')}>
      Dranzeit
    </span>
  </Link>
);
