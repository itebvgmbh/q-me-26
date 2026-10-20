// Verbrauch eines Ladens im laufenden Monat: Nummern und Termine (ohne abgesagte).
// Grenze im Gratis-Tarif: PLANS.gratis.maxCustomersPerMonth (utils/plans.ts).
import { useEffect, useState } from 'react';
import { collection, getDocs, limit, query, Timestamp, where } from 'firebase/firestore';
import { firestore } from './firestore-client';
import { effectivePlan, type ShopPlanFields } from './plans';

export const monthRange = (now: Date = new Date()) => {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
};

export const countCustomersThisMonth = async (shopId: string, now: Date = new Date()): Promise<number> => {
  const { start, end } = monthRange(now);
  // Gleiche Abfrage wie der Tresen (shopId + startTime); abgesagte zählen nicht
  const snap = await getDocs(
    query(
      collection(firestore, 'appointments'),
      where('shopId', '==', shopId),
      where('startTime', '>=', Timestamp.fromDate(start)),
      where('startTime', '<', Timestamp.fromDate(end)),
      limit(2000),
    ),
  );
  return snap.docs.filter((d) => d.data().status !== 'cancelled').length;
};

export interface MonthlyUsage {
  used: number | null;
  max: number | null;
  /** Grenze erreicht: online keine Nummern mehr */
  full: boolean;
}

/** Nur im Gratis-Tarif wird gezählt; sonst sofort "unbegrenzt". */
export const useMonthlyUsage = (shopId: string | undefined, shop: ShopPlanFields | null | undefined): MonthlyUsage => {
  const max = shop ? effectivePlan(shop).plan.maxCustomersPerMonth : null;
  const [used, setUsed] = useState<number | null>(null);

  useEffect(() => {
    if (!shopId || max === null) return;
    let alive = true;
    countCustomersThisMonth(shopId)
      .then((n) => alive && setUsed(n))
      .catch(() => alive && setUsed(null));
    return () => {
      alive = false;
    };
  }, [shopId, max]);

  return { used, max, full: max !== null && used !== null && used >= max };
};
