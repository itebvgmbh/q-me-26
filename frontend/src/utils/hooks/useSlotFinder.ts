import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { TimeSlot } from '../types';
import { Staff } from '../firestore';
import { findEarliestSlots } from '../firestore/timeslots';

type SearchState =
  | { key: string; status: 'done'; earliest: Record<string, TimeSlot | null> }
  | { key: string; status: 'failed' };

/**
 * Sucht den frühesten freien Platz für ALLE Personen, die die Leistung anbieten – einmal, sobald
 * Shop und Leistung feststehen (schon während der Personenauswahl). Die Wahl der Person filtert
 * danach nur noch das fertige Ergebnis, ohne neue Suche. Bei "egal wer" gewinnt der früheste Platz.
 */
export const useSlotFinder = (options: {
  shopId: string;
  serviceId: string;
  staffId: string;
  useAnyStaff: boolean;
  staffList: Staff[];
  shouldSearch: boolean;
}) => {
  const { shopId, serviceId, staffId, useAnyStaff, staffList, shouldSearch } = options;

  const [state, setState] = useState<SearchState | null>(null);
  const [round, setRound] = useState(0);
  const loadedAt = useRef(0);

  // Fehlt isActive im Dokument, gilt die Person als aktiv
  const staffKey = useMemo(
    () => staffList.filter((s) => s.isActive !== false).map((s) => s.id).join(','),
    [staffList],
  );
  const canSearch = !!(shopId && serviceId && staffKey && shouldSearch);
  const key = `${shopId}|${serviceId}|${staffKey}|${round}`;

  useEffect(() => {
    if (!canSearch) return;
    // Ergebnisse einer überholten Suche verwerfen
    let active = true;
    findEarliestSlots(shopId, serviceId, staffKey.split(','))
      .then((earliest) => {
        if (!active) return;
        loadedAt.current = Date.now();
        setState({ key, status: 'done', earliest });
      })
      .catch((error) => {
        console.error('Error finding available slot:', error);
        if (!active) return;
        setState({ key, status: 'failed' });
        toast.error(t('Die freien Plätze konnten nicht geladen werden. Versuch es gleich noch einmal.'));
      });
    return () => {
      active = false;
    };
    // key enthält shopId, serviceId, staffKey und round
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, canSearch]);

  // Nur ein Ergebnis zur aktuellen Auswahl zählt – nie kurz das alte nach einem Wechsel zeigen
  const current = state && state.key === key ? state : null;
  const earliestByStaff = current?.status === 'done' ? current.earliest : null;
  const searchingForSlot = canSearch && !current;

  const pick = useMemo(() => {
    if (!earliestByStaff) return null;
    const candidates = Object.entries(earliestByStaff)
      .filter(([id, slot]) => slot && (useAnyStaff || id === staffId))
      .sort(([, a], [, b]) => a!.start.getTime() - b!.start.getTime());
    return candidates.length > 0 ? { staffId: candidates[0][0], slot: candidates[0][1]! } : null;
  }, [earliestByStaff, useAnyStaff, staffId]);

  /** Neu suchen, z. B. wenn der Platz beim Einreihen schon weg war */
  const refresh = useCallback(() => setRound((r) => r + 1), []);
  /** Neu suchen, wenn das Ergebnis älter ist als maxAgeMs (Kunde stand länger auf einem Schritt) */
  const refreshIfOlderThan = useCallback(
    (maxAgeMs: number) => {
      if (loadedAt.current && Date.now() - loadedAt.current > maxAgeMs) refresh();
    },
    [refresh],
  );

  return {
    searchingForSlot,
    searchFailed: current?.status === 'failed',
    nextAvailableSlot: pick?.slot ?? null,
    selectedStaffForSlot: pick?.staffId ?? '',
    earliestByStaff,
    refresh,
    refreshIfOlderThan,
  };
};
