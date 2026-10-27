import { Link } from 'react-router-dom';
import type { Shop } from '../../utils/firestore';
import { effectivePlan } from '../../utils/plans';
import { useMonthlyUsage } from '../../utils/plan-usage';
import { HILFE_MAIL } from '../HilfeLink';
import { t, tn, tTeile } from '@/i18n';

/** Hinweis am Tresen: Testphase, Gratis-Kontingent oder offene Zahlung. Bei laufendem Abo nichts. */
export const PlanBanner = ({ shop }: { shop: Shop }) => {
  const current = effectivePlan(shop);
  const usage = useMonthlyUsage(shop.id, shop);

  if (shop.suspended) {
    return (
      <div role="alert" className="rounded-2xl bg-destructive px-4 py-3 text-sm font-semibold text-destructive-foreground">
        {tTeile('Dein Laden ist gesperrt: Kunden finden ihn nicht und können nichts buchen. Bitte meld dich bei <mail/>.', {
          mail: () => <bdi>{HILFE_MAIL}</bdi>,
        })}
      </div>
    );
  }

  let text = '';
  let urgent = false;
  if (current.source === 'abo') {
    if (shop.billing?.status !== 'past_due') return null;
    text = t('Die letzte Zahlung für dein Abo ist offen. Bitte prüf deine Zahlungsart.');
    urgent = true;
  } else if (current.source === 'freischaltung') {
    const daysLeft = current.grantUntil ? Math.ceil((current.grantUntil.getTime() - Date.now()) / 86_400_000) : 0;
    if (daysLeft > 7) return null;
    text = tn(daysLeft, 'Deine Freischaltung für {plan} endet in {n} Tag.', 'Deine Freischaltung für {plan} endet in {n} Tagen.', {
      plan: t(current.plan.name),
    });
  } else if (current.source === 'test') {
    if (current.trialDaysLeft > 7 && !shop.founder) return null;
    text = shop.founder
      ? tn(
          current.trialDaysLeft,
          'Gründer: noch {n} Tag kostenlos. Danach Laden für 19 € im Monat, sobald du das Abo abschließt.',
          'Gründer: noch {n} Tage kostenlos. Danach Laden für 19 € im Monat, sobald du das Abo abschließt.',
        )
      : tn(
          current.trialDaysLeft,
          'Deine Testphase endet in {n} Tag. Danach Gratis mit 100 Kunden im Monat.',
          'Deine Testphase endet in {n} Tagen. Danach Gratis mit 100 Kunden im Monat.',
        );
  } else if (usage.full) {
    text = t('Die {max} Gratis-Kunden für diesen Monat sind erreicht. Online kann gerade niemand eine Nummer ziehen.', { max: usage.max ?? '' });
    urgent = true;
  } else {
    text = t('Gratis-Tarif: {genutzt} von {max} Kunden diesen Monat.', { genutzt: usage.used ?? '…', max: usage.max ?? '' });
  }

  return (
    <Link
      to="/tarif"
      className={
        urgent
          ? 'flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-destructive px-4 py-3 text-sm font-semibold text-destructive-foreground'
          : 'flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-signal px-4 py-3 text-sm font-semibold text-signal-foreground'
      }
    >
      <span>{text}</span>
      <span className="underline underline-offset-2">{t('Tarif ansehen')}</span>
    </Link>
  );
};
