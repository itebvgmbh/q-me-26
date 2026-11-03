import { useEffect, useState } from 'react';
import { t, tn } from '@/i18n';

type Tag = { dayOfWeek?: unknown; isOpen?: boolean; openTime?: string; closeTime?: string; breaks?: { startTime?: string; endTime?: string }[] };

/**
 * Ist der Laden gerade offen? Wie der Einbau-Kasten (backend/app/einbau.py, opening_status), Uhrzeit des Browsers.
 * null, wenn der Laden keine Öffnungszeiten je Tag eingetragen hat.
 */
export const oeffnungJetzt = (shop: { businessHoursByDay?: Tag[] } | null | undefined, now = new Date()): { offen: boolean; text: string } | null => {
  const tage = shop?.businessHoursByDay;
  if (!Array.isArray(tage) || tage.length === 0) return null;
  const tag = tage.find((d) => Number(d.dayOfWeek) === now.getDay());
  if (!tag) return null;
  if (!tag.isOpen) return { offen: false, text: t('Heute geschlossen') };
  const uhr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const auf = tag.openTime ?? '';
  const zu = tag.closeTime ?? '';
  if (uhr < auf) return { offen: false, text: t('Heute ab {zeit} Uhr geöffnet', { zeit: auf }) };
  if (uhr >= zu) return { offen: false, text: t('Für heute geschlossen') };
  const pause = (tag.breaks ?? []).find((p) => (p.startTime ?? '') <= uhr && uhr < (p.endTime ?? ''));
  if (pause) return { offen: false, text: t('Pause bis {zeit} Uhr', { zeit: pause.endTime ?? '' }) };
  return { offen: true, text: t('Geöffnet bis {zeit} Uhr', { zeit: zu }) };
};

export const wartendeText = (anzahl: number) =>
  anzahl === 0 ? t('Gerade wartet niemand') : tn(anzahl, 'Gerade wartet {n} Person', 'Gerade warten {n} Personen');

/** Wie viele gerade warten, je Laden (backend/app/apis/laden_live); alle 2 Minuten neu, solange die Seite sichtbar ist */
export const useWartende = (ids: string[]): Record<string, number> => {
  const key = [...new Set(ids)].sort().join(',');
  const [warten, setWarten] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!key) return;
    let aktuell = true;
    const laden = () =>
      fetch(`/routes/laden-live?ids=${encodeURIComponent(key)}`)
        .then((res) => (res.ok ? (res.json() as Promise<{ warten?: Record<string, number> }>) : null))
        .then((daten) => {
          if (aktuell && daten) setWarten(daten.warten ?? {});
        })
        .catch(() => {}); // ohne Zahl zeigt die Karte nur die Öffnungszeit
    laden();
    const timer = setInterval(() => {
      if (!document.hidden) laden();
    }, 120_000);
    return () => {
      aktuell = false;
      clearInterval(timer);
    };
  }, [key]);
  return warten;
};
