import { Link } from 'react-router-dom';
import type { Shop } from '../../utils/firestore';
import { effectivePlan } from '../../utils/plans';
import { useMonthlyUsage } from '../../utils/plan-usage';

/** Hinweis am Tresen: Testphase, Gratis-Kontingent oder offene Zahlung. Bei laufendem Abo nichts. */
export const PlanBanner = ({ shop }: { shop: Shop }) => {
  const current = effectivePlan(shop);
  const usage = useMonthlyUsage(shop.id, shop);

  let text = '';
  let urgent = false;
  if (current.source === 'abo') {
    if (shop.billing?.status !== 'past_due') return null;
    text = 'Die letzte Zahlung für dein Abo ist offen. Bitte prüf deine Zahlungsart.';
    urgent = true;
  } else if (current.source === 'test') {
    if (current.trialDaysLeft > 7 && !shop.founder) return null;
    text = shop.founder
      ? `Gründer: noch ${current.trialDaysLeft} Tage kostenlos, danach Laden für 19 € im Monat.`
      : `Deine Testphase endet in ${current.trialDaysLeft} ${current.trialDaysLeft === 1 ? 'Tag' : 'Tagen'}. Danach Gratis mit 100 Kunden im Monat.`;
  } else if (usage.full) {
    text = `Die ${usage.max} Gratis-Kunden für diesen Monat sind erreicht. Online kann gerade niemand eine Nummer ziehen.`;
    urgent = true;
  } else {
    text = `Gratis-Tarif: ${usage.used ?? '…'} von ${usage.max} Kunden diesen Monat.`;
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
      <span className="underline underline-offset-2">Tarif ansehen</span>
    </Link>
  );
};
