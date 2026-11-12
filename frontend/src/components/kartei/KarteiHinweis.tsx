import { Link } from 'react-router-dom';
import { inStoreApp } from '../../utils/app-shell';
import { t } from '@/i18n';

/** Tarif ohne Kartei (Gratis): Liste und Termine gibt es, Besuche, Umsatz und Notizen ab Solo */
export const KarteiHinweis = ({ inhaber }: { inhaber: boolean }) => (
  <div className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-5">
    <p className="font-semibold">{t('Besuche, Umsatz und Notizen je Kunde gehören zum Tarif Solo.')}</p>
    <p className="text-sm text-muted-foreground">
      {t('Damit siehst du, wer Stammkunde ist und wer lange nicht da war, und hältst fest, was du beim letzten Mal gemacht hast, etwa die Farbrezeptur.')}
    </p>
    {inhaber && !inStoreApp() && (
      <Link to="/tarif" className="mt-1 w-fit rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background">
        {t('Tarif ansehen')}
      </Link>
    )}
  </div>
);
