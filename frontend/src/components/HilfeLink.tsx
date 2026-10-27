import type { ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';

export const HILFE_MAIL = 'hilfe@dranzeit.de';

/**
 * Verweis auf einen Artikel unter /hilfe/<hilfe>. Die Hilfe liefert das Backend aus (backend/app/hilfe),
 * deshalb ein normaler Link statt Router-Link – und ein neuer Tab, damit angefangene Eingaben bleiben.
 * Dass jeder Artikel existiert, prüft backend/tests/test_hilfe.py.
 */
export const HilfeLink = ({ hilfe, children = t('Mehr dazu'), className }: { hilfe: string; children?: ReactNode; className?: string }) => (
  <a
    href={`/hilfe/${hilfe}`}
    target="_blank"
    rel="noopener"
    className={cn('inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4 hover:no-underline', className)}
  >
    <CircleHelp className="h-4 w-4 shrink-0" aria-hidden="true" />
    {children}
    <span className="sr-only"> {t('(öffnet in neuem Tab)')}</span>
  </a>
);
