// Verbrauch eines Ladens im laufenden Monat: Nummern und Termine (ohne abgesagte).
// Grenze im Gratis-Tarif: PLANS.gratis.maxCustomersPerMonth (utils/plans.ts).
import { useEffect, useState } from 'react';
import { liveLesen, teamTerminePfad } from './live';
import { effectivePlan, type ShopPlanFields } from './plans';
import type { Appointment } from './firestore/types';

export const monthRange = (now: Date = new Date()) => {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
};

/** Für Inhaber und Team (Mein Tarif, Hinweis am Tresen): Termine des Monats wie am Tresen, abgesagte zählen nicht */
export const countCustomersThisMonth = async (shopId: string, now: Date = new Date()): Promise<number> => {
  const { start, end } = monthRange(now);
  const { termine } = await liveLesen<{ termine: Appointment[] }>(teamTerminePfad(shopId, start, end), true);
  return termine.filter((a) => a.status !== 'cancelled').length;
};

/** Öffentlich (Nummer ziehen): nur, ob die Grenze erreicht ist – dieselbe Rechnung wie beim Ziehen im Backend */
const monatVoll = async (shopId: string): Promise<boolean> =>
  (await liveLesen<{ voll: boolean }>(`live/laden/${encodeURIComponent(shopId)}/monat`)).voll;

export interface MonthlyUsage {
  used: number | null;
  max: number | null;
  /** Grenze erreicht: online keine Nummern mehr */
  full: boolean;
}

/**
 * Nur im Gratis-Tarif wird gezählt; sonst sofort "unbegrenzt". oeffentlich: für Kunden (Nummer ziehen) – dann ohne
 * Zahl, nur ob voll; das Team sieht die Zahl.
 */
export const useMonthlyUsage = (
  shopId: string | undefined,
  shop: ShopPlanFields | null | undefined,
  { oeffentlich = false }: { oeffentlich?: boolean } = {},
): MonthlyUsage => {
  const max = shop ? effectivePlan(shop).plan.maxCustomersPerMonth : null;
  const [used, setUsed] = useState<number | null>(null);
  const [voll, setVoll] = useState(false);

  useEffect(() => {
    setUsed(null);
    setVoll(false);
    if (!shopId || max === null) return;
    let alive = true;
    if (oeffentlich) {
      monatVoll(shopId)
        .then((v) => alive && setVoll(v))
        .catch(() => alive && setVoll(false)); // im Zweifel ziehen lassen, das Backend prüft beim Ziehen
    } else {
      countCustomersThisMonth(shopId)
        .then((n) => alive && setUsed(n))
        .catch(() => alive && setUsed(null));
    }
    return () => {
      alive = false;
    };
  }, [shopId, max, oeffentlich]);

  return { used, max, full: max !== null && (voll || (used !== null && used >= max)) };
};
