import { ReactNode } from 'react';
import { ArrowRight, Store, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils';

export const ROLE_CHOICES = [
  {
    role: 'customer' as const,
    icon: Ticket,
    title: 'Ich will buchen',
    text: 'Nummer ziehen oder feste Uhrzeit buchen, alles unter „Meine Termine“ sehen und frühere Plätze angeboten bekommen.',
  },
  {
    role: 'shopOwner' as const,
    icon: Store,
    title: 'Ich habe einen Betrieb',
    text: 'Schlange und Termine am Tresen steuern, Leistungen und Team pflegen, Kunden per QR-Code einreihen lassen.',
  },
];

/** Große Auswahlkarte – als Link oder Button nutzbar */
export const RoleChoiceCard = ({
  icon: Icon,
  title,
  text,
  as = 'div',
  dark = false,
  children,
}: {
  icon: typeof Ticket;
  title: string;
  text: string;
  as?: 'div' | 'span';
  dark?: boolean;
  children?: ReactNode;
}) => {
  const Tag = as;
  return (
    <Tag
      className={cn(
        'group flex h-full flex-col gap-4 rounded-3xl border p-6 text-left transition-colors',
        dark ? 'border-foreground bg-foreground text-background' : 'border-border bg-card hover:border-foreground',
      )}
    >
      <span className={cn('flex h-12 w-12 items-center justify-center rounded-2xl', dark ? 'bg-signal text-signal-foreground' : 'bg-foreground text-signal')}>
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <span className="font-display text-2xl font-bold">{title}</span>
      <span className={cn('text-sm', dark ? 'text-background/75' : 'text-muted-foreground')}>{text}</span>
      <span className="mt-auto flex items-center gap-2 font-semibold">
        {children ?? 'Weiter'}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
      </span>
    </Tag>
  );
};
