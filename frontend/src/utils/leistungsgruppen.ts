/**
 * Leistungsgruppen für „Läden finden“ (Regeln in data/leistungsgruppen.json, dasselbe im Backend in
 * backend/app/libs/leistungsgruppen.py, gemeinsame Fälle in dev/leistungsgruppen-faelle.json).
 *
 * Ohne React, ohne Übersetzungen und ohne JSON-Import, damit dev/suche.test.mjs es in Node prüft: Die Regeln kommen
 * als Daten herein (leistungsgruppen(DATEN)); die App bindet sie in utils/suche-daten.ts (GRUPPEN).
 */
import { normSuche } from './suche.ts';

export type Regel = { gruppe: string; woerter: string[]; und?: string[]; nicht?: string[] };
export type Gruppe = { key: string; name: string; auch?: string[] };
export type GruppenDaten = {
  gruppen: Gruppe[];
  name: Regel[];
  kategorie: Regel[];
  schnitt: { woerter: string[]; gruppe: string; herren: string[] };
  ohneLeistungen: Record<string, string[]>;
};
/** Was der Inhaber an der Leistung festlegt: Schlüssel einer Gruppe, „keine“ oder nichts (= automatisch) */
export const KEINE = 'keine';

/** „_x“: ein Wort fängt mit x an; sonst irgendwo im Text (für zusammengesetzte Wörter wie „Herrenhaarschnitt“) */
const trifft = (text: string, wort: string) => (wort.startsWith('_') ? ` ${text}`.includes(` ${wort.slice(1)}`) : text.includes(wort));
const einer = (text: string, woerter: string[] = []) => woerter.some((w) => trifft(text, w));
const passtRegel = (text: string, r: Regel) => einer(text, r.woerter) && (!r.und || einer(text, r.und)) && !einer(text, r.nicht);

export const leistungsgruppen = (daten: GruppenDaten) => {
  const nachKey = new Map(daten.gruppen.map((g) => [g.key, g]));

  /** Gruppe per Stichwort: erst der Name, dann die Kategorie, zuletzt ein allgemeiner Schnitt (kontext: Ladenname) */
  const auto = (leistung: { name?: string; category?: string }, kontext = ''): string | null => {
    const name = normSuche(leistung.name);
    const r = daten.name.find((x) => passtRegel(name, x));
    if (r) return r.gruppe;
    const kategorie = normSuche(leistung.category);
    const k = kategorie ? daten.kategorie.find((x) => passtRegel(kategorie, x)) : undefined;
    if (k) return k.gruppe;
    if (einer(name, daten.schnitt.woerter)) return einer(normSuche(kontext), daten.schnitt.herren) ? 'herren' : daten.schnitt.gruppe;
    return null;
  };

  /** Was gilt: vom Inhaber festgelegt, sonst automatisch */
  const wirksam = (leistung: { name?: string; category?: string; gruppe?: string | null }, kontext = ''): string | null => {
    if (leistung.gruppe === KEINE) return null;
    if (leistung.gruppe && nachKey.has(leistung.gruppe)) return leistung.gruppe;
    return auto(leistung, kontext);
  };

  /** Welche Gruppen bei der Suche nach einer Gruppe mitzählen („Herrenhaarschnitt“ findet auch „Haarschnitt“) */
  const menge = (key: string): string[] => [key, ...(nachKey.get(key)?.auch ?? [])];

  /**
   * Welche Gruppe jemand mit „Was?“ meint: genau ein Gruppenname (deutsch oder übersetzt) oder ein Text, den die
   * Stichwörter einordnen („Herrenschnitt“, „Balayage“). Sonst null – dann sucht die Seite nur nach dem Text.
   */
  const ausText = (text: string, uebersetzt: (name: string) => string = (n) => n): string | null => {
    const n = normSuche(text);
    if (!n) return null;
    const genau = daten.gruppen.find((g) => g.key === n || normSuche(g.name) === n || normSuche(uebersetzt(g.name)) === n);
    return genau ? genau.key : auto({ name: text });
  };

  return { liste: daten.gruppen, gruppe: (key: string) => nachKey.get(key), auto, wirksam, menge, ausText };
};

export type Gruppen = ReturnType<typeof leistungsgruppen>;
