import { Clock, Monitor, Settings, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ROLLEN, gespeichertesGeraet, type GeraetRolle } from '../utils/geraet';
import { t } from '@/i18n';

const ICONS: Record<GeraetRolle, typeof Users> = { tresen: Users, handy: Clock, bildschirm: Monitor, buero: Settings };

interface Props {
  open: boolean;
  onChoose: (rolle: GeraetRolle) => void;
  /** „Später“ – ohne das ist die Frage nicht wegzuklicken, wenn sie von selbst kommt */
  onLater: () => void;
}

/**
 * Einmal je Gerät: Wofür ist es da? Danach startet es immer in seiner Ansicht (utils/geraet.ts).
 * So muss niemand wissen, welche Ansicht aufs Tablet am Tresen gehört.
 */
export function GeraetWahl({ open, onChoose, onLater }: Props) {
  const aktuell = gespeichertesGeraet()?.rolle;
  return (
    <Dialog open={open} onOpenChange={(offen) => !offen && onLater()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{t('Wofür nutzt du dieses Gerät?')}</DialogTitle>
          <DialogDescription>{t('Wir merken es uns. Danach startet das Gerät immer in seiner Ansicht – ändern kannst du es unter „Laden“.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          {ROLLEN.map(({ rolle, titel, text }) => {
            const Icon = ICONS[rolle];
            return (
              <button
                key={rolle}
                type="button"
                aria-pressed={aktuell === rolle}
                onClick={() => onChoose(rolle)}
                className={cn(
                  'flex flex-col items-start gap-1.5 rounded-2xl border p-4 text-start transition-colors',
                  rolle === 'tresen' ? 'border-foreground bg-signal text-signal-foreground' : 'border-border bg-card hover:border-foreground',
                  aktuell === rolle && 'ring-2 ring-foreground ring-offset-2',
                )}
              >
                <span className="flex items-center gap-2 font-display text-lg font-bold">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {t(titel)}
                </span>
                <span className={cn('text-sm', rolle === 'tresen' ? 'text-signal-foreground/80' : 'text-muted-foreground')}>{t(text)}</span>
              </button>
            );
          })}
        </div>
        <Button variant="ghost" className="self-start" onClick={onLater}>
          {t('Später')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
