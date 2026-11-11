import { useEffect, useState } from 'react';
import type { Frei, Ort, SuchLaden, SuchSalon } from './suche';
import ORTE_BERLIN from '../data/orte-berlin.json';
import { intlSprache, t } from '@/i18n';

/** Berliner Bezirke und Ortsteile mit Mittelpunkt (einmal aus OpenStreetMap geholt, © OpenStreetMap-Mitwirkende) */
export const ORTE = ORTE_BERLIN as Ort[];

type Laeden = { laeden: SuchLaden[]; salons: SuchSalon[] };

/** Alle Läden und Salons für die Suche (backend/app/apis/suche); einmal je Seitenaufruf */
export const useSuchDaten = () => {
  const [daten, setDaten] = useState<Laeden | null>(null);
  const [fehler, setFehler] = useState<unknown>(null);
  const [versuch, setVersuch] = useState(0);
  useEffect(() => {
    let aktuell = true;
    setFehler(null);
    fetch('/routes/suche/laeden')
      .then((res) => {
        if (!res.ok) throw new Error(`suche/laeden ${res.status}`);
        return res.json() as Promise<Laeden>;
      })
      .then((d) => aktuell && setDaten(d))
      .catch((e) => aktuell && setFehler(e));
    return () => {
      aktuell = false;
    };
  }, [versuch]);
  return { daten, fehler, nochmal: () => setVersuch((v) => v + 1) };
};

/**
 * Freie Zeiten, Nummer und Wartende je Laden (höchstens 12 auf einmal, wie das Backend); alle 2 Minuten neu, solange
 * die Seite sichtbar ist. Schon geholte bleiben stehen, bis neue da sind – sonst flackert die Liste.
 */
export const useFreieZeiten = (ids: string[], was: string): Record<string, Frei> => {
  const key = `${[...new Set(ids)].sort().join(',')}|${was.trim().toLowerCase()}`;
  const [frei, setFrei] = useState<Record<string, Frei>>({});
  useEffect(() => {
    const [liste, leistung] = key.split('|');
    if (!liste) return;
    let aktuell = true;
    const laden = () =>
      fetch(`/routes/suche/frei?${new URLSearchParams({ ids: liste, leistung })}`)
        .then((res) => (res.ok ? (res.json() as Promise<{ frei?: Record<string, Frei> }>) : null))
        .then((d) => {
          if (aktuell && d?.frei) setFrei((alt) => ({ ...alt, ...d.frei }));
        })
        .catch(() => {}); // ohne Zeiten zeigt die Karte Adresse und Öffnungszeit
    laden();
    const timer = setInterval(() => {
      if (!document.hidden) laden();
    }, 120_000);
    return () => {
      aktuell = false;
      clearInterval(timer);
    };
  }, [key]);
  // Andere Leistung gesucht: alte Zeiten passen nicht mehr
  useEffect(() => setFrei({}), [was]);
  return frei;
};

/** Postleitzahl, Adresse oder Ort außerhalb der Liste über das Backend (OpenStreetMap); null = nicht gefunden */
export const ortAufloesen = async (text: string): Promise<Ort | null> => {
  const res = await fetch(`/routes/suche/ort?${new URLSearchParams({ q: text.trim() })}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`suche/ort ${res.status}`);
  const o = (await res.json()) as { name: string; lat: number; lng: number };
  return { name: o.name || text.trim(), typ: /^\d{5}$/.test(text.trim()) ? 'plz' : 'adresse', lat: o.lat, lng: o.lng };
};

const gleicherTag = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** „heute 15:30“, „morgen 9:00“, „Fr. 9:00“ */
export const zeitKurz = (iso: string, jetzt = new Date()): string => {
  const d = new Date(iso);
  const uhr = d.toLocaleTimeString(intlSprache(), { hour: 'numeric', minute: '2-digit' });
  const morgen = new Date(jetzt);
  morgen.setDate(morgen.getDate() + 1);
  if (gleicherTag(d, jetzt)) return t('heute {zeit}', { zeit: uhr });
  if (gleicherTag(d, morgen)) return t('morgen {zeit}', { zeit: uhr });
  return `${d.toLocaleDateString(intlSprache(), { weekday: 'short' })} ${uhr}`;
};

export const kmText = (wert: number) =>
  wert < 1
    ? `${Math.max(50, Math.round((wert * 1000) / 50) * 50).toLocaleString(intlSprache())} m`
    : `${wert.toLocaleString(intlSprache(), { maximumFractionDigits: 1 })} km`;
