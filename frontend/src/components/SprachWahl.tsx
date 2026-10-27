import { Check, Globe } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { SPRACHEN, sprache, t, wechsleSprache } from '@/i18n';

/** Kugel mit Kürzel in der Kopfzeile; die Namen stehen in ihrer eigenen Sprache */
export function SprachMenue({ className }: { className?: string }) {
  const aktuell = sprache();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('Sprache wählen')}
          title={t('Sprache wählen')}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold uppercase text-foreground hover:bg-foreground/5',
            className,
          )}
        >
          <Globe className="h-5 w-5" aria-hidden="true" />
          {aktuell}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-44 rounded-xl" align="end">
        {SPRACHEN.map((s) => (
          <DropdownMenuItem key={s.code} lang={s.code} dir={s.rtl ? 'rtl' : 'ltr'} onSelect={() => s.code !== aktuell && wechsleSprache(s.code)}>
            <span className="flex-1">{s.name}</span>
            {s.code === aktuell && <Check className="h-4 w-4" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Alle Sprachen nebeneinander – im Handy-Menü und in der Fußzeile */
export function SprachListe({ className }: { className?: string }) {
  const aktuell = sprache();
  return (
    <div role="group" aria-label={t('Sprache')} className={cn('flex flex-wrap gap-x-4 gap-y-1', className)}>
      {SPRACHEN.map((s) => (
        <button
          key={s.code}
          type="button"
          lang={s.code}
          aria-current={s.code === aktuell ? 'true' : undefined}
          onClick={() => s.code !== aktuell && wechsleSprache(s.code)}
          className={cn(
            'inline-flex min-h-11 items-center hover:text-foreground',
            s.code === aktuell && 'font-semibold text-foreground underline underline-offset-4',
          )}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}
