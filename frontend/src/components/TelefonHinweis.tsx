import { Link } from 'react-router-dom';
import { Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTelefonStand, type TelefonStand } from '../utils/telefon-assistent';
import { t } from '@/i18n';

/** Was der Inhaber zum Telefon-Assistenten wissen muss: warum er nicht abnimmt, oder dass 80 % verbraucht sind */
export const telefonHinweisText = (stand: TelefonStand): string | null => {
  const v = stand.verbrauch;
  switch (stand.grund) {
    case 'test_verbraucht':
      return t('Die Testminuten sind aufgebraucht. Anrufer hören nur eine kurze Ansage, bis du den Zusatz buchst.');
    case 'deckel':
      return t('Dein Kostendeckel ist erreicht. Anrufer hören bis zum Monatsende nur eine kurze Ansage.');
    case 'zahlung':
      return t('Die letzte Zahlung ist offen. Bis sie da ist, hören Anrufer nur eine kurze Ansage.');
    case 'gekuendigt':
      return t('Der Zusatz ist beendet. Anrufer hören nur eine kurze Ansage.');
    case null:
      if (stand.warnung < 80) return null;
      return v.art === 'test'
        ? t('{minuten} von {grenze} Testminuten verbraucht.', { minuten: v.minuten, grenze: v.grenze })
        : t('{minuten} von {grenze} Minuten bis zu deinem Kostendeckel verbraucht.', { minuten: v.minuten, grenze: v.grenze });
    default:
      return null;
  }
};

/** Hinweis im Dashboard (Tresen) und unter „Laden“, nur wenn der Assistent eingeschaltet ist */
export function TelefonHinweis({ stand }: { stand: TelefonStand | null }) {
  if (!stand?.aktiv) return null;
  const text = telefonHinweisText(stand);
  if (!text) return null;
  return (
    <div role="status" className="flex flex-col gap-3 rounded-2xl border-2 border-signal bg-signal/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2 text-sm">
        <Phone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          <strong>{t('Telefon-Assistent:')}</strong> {text}
        </span>
      </p>
      <Button size="sm" variant="outline" className="w-fit shrink-0" asChild>
        <Link to="/telefon-assistent">{t('Ansehen')}</Link>
      </Button>
    </div>
  );
}

/** Dasselbe mit eigenem Abruf, für Seiten, die den Stand sonst nicht brauchen */
export function TelefonHinweisLaden({ shopId }: { shopId: string }) {
  return <TelefonHinweis stand={useTelefonStand(shopId)} />;
}
