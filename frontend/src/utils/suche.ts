/**
 * Läden finden (pages/ShopMap.tsx, Schritt „Laden“ beim Buchen): suchen, filtern, sortieren, Vorschläge – ohne React,
 * ohne Netz und ohne Übersetzungen, damit dev/suche.test.mjs es ohne Browser prüft.
 *
 * Daten: GET /routes/suche/laeden (alle Läden mit Lage und Leistungen, Salons ohne Dranzeit) und /routes/suche/frei
 * (warten, Nummer, nächste Termine) aus backend/app/apis/suche. Die Liste ist klein genug, dass der Browser selbst
 * filtert – sofort, ohne Laden. Orte für „Wo?“ aus data/orte-berlin.json (Bezirke und Ortsteile mit Mittelpunkt);
 * Postleitzahlen und Adressen löst das Backend auf (GET /routes/suche/ort).
 *
 * Datenschutz: Der eigene Standort und der Kartenausschnitt stehen nie in der Adresse der Seite, nur was und wo
 * jemand eingetippt hat.
 */

export type Leistung = { id: string; name: string; price: number; duration: number; category?: string };
export type Tag = { dayOfWeek?: unknown; isOpen?: boolean; openTime?: string; closeTime?: string; breaks?: { startTime?: string; endTime?: string }[] };

export type SuchLaden = {
  id: string;
  name: string;
  logoUrl?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  industry?: string;
  phone?: string;
  ortsteil?: string;
  bezirk?: string;
  lat?: number | null;
  lng?: number | null;
  termine?: boolean;
  pfad?: string;
  businessHoursByDay?: Tag[];
  leistungen: Leistung[];
};

export type SuchSalon = {
  id: string;
  name: string;
  kategorie: string;
  street: string;
  postalCode: string;
  city: string;
  ortsteil: string;
  bezirk: string;
  pfad: string;
  lat: number;
  lng: number;
  leistungen: string[];
};

export type Frei = {
  warten: number;
  leistung: Leistung | null;
  /** ungefähr dran mit einer Nummer, die man jetzt zieht (heute), ISO */
  nummer: string | null;
  /** die nächsten freien Termine (7 Tage) */
  termine: { start: string; personId: string }[];
};

export type OrtTyp = 'stadt' | 'bezirk' | 'ortsteil' | 'plz' | 'adresse' | 'nahe' | 'karte';
export type Ort = { name: string; typ: OrtTyp; bezirk?: string; lat: number; lng: number };
export type Punkt = { lat: number; lng: number };
export type Grenzen = { sued: number; west: number; nord: number; ost: number };
/** Wo gesucht wird: um einen Punkt (Ort, eigener Standort) oder im Kartenausschnitt */
/** ort: gesuchter Ort – Läden, deren Bezirk bzw. Ortsteil so heißt, gehören dazu, auch außerhalb des Umkreises */
export type Bereich = { mitte: Punkt; radiusKm: number; ort?: Ort } | { grenzen: Grenzen };

export type Filter = 'offen' | 'heute' | 'kurz' | 'termine';
export type Sortierung = 'empfohlen' | 'entfernung' | 'warten' | 'preis';
export const FILTER: Filter[] = ['offen', 'heute', 'kurz', 'termine'];
export const SORTIERUNGEN: Sortierung[] = ['empfohlen', 'entfernung', 'warten', 'preis'];

/** Umkreis je Art des Orts: so weit gilt ein Laden noch als „in“ dem Ort */
export const RADIUS_KM: Record<OrtTyp, number> = { stadt: 15, bezirk: 5, ortsteil: 2, plz: 2, adresse: 1.5, nahe: 3, karte: 0 };
/** Weniger Treffer als das im Bereich: die nächsten außerhalb zeigen („Etwas weiter weg“), höchstens so weit */
export const MINDESTENS = 3;
export const WEITER_KM = 15;
/** „Kaum Wartezeit“: höchstens so viele warten gerade */
export const KURZ_WARTEN = 2;

// --- Text -------------------------------------------------------------------------------------------------------------

/** Für Vergleiche: klein, ohne Akzente, ä→ae (wie norm in backend/app/apis/suche) */
export const normSuche = (text: string | null | undefined): string =>
  (text ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Alle Wörter der Suche stehen irgendwo im Text („schnitt“ findet „Herrenhaarschnitt“) */
export const passt = (text: string, suche: string): boolean => {
  const woerter = normSuche(suche).split(' ').filter(Boolean);
  const t = normSuche(text);
  return woerter.length > 0 && woerter.every((w) => t.includes(w));
};

const leistungText = (l: Leistung) => `${l.name} ${l.category ?? ''}`;

export const ladenPasst = (laden: SuchLaden, was: string): boolean =>
  !normSuche(was) || passt(laden.name, was) || laden.leistungen.some((l) => passt(leistungText(l), was));

/** Die gesuchte Leistung dieses Ladens (für Preis und freie Zeiten); ohne Suche keine */
export const passendeLeistung = (laden: SuchLaden, was: string): Leistung | undefined =>
  normSuche(was) ? laden.leistungen.find((l) => passt(leistungText(l), was)) : undefined;

/** Kleinster Preis über 0 € */
export const abPreis = (laden: SuchLaden): number | null => {
  const preise = laden.leistungen.map((l) => l.price).filter((p) => p > 0);
  return preise.length ? Math.min(...preise) : null;
};

// --- Ort und Entfernung ------------------------------------------------------------------------------------------------

export const km = (a: Punkt, b: Punkt): number => {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

export const hatLage = (x: { lat?: number | null; lng?: number | null }): x is { lat: number; lng: number } =>
  typeof x.lat === 'number' && typeof x.lng === 'number';

export const imBereich = (p: Punkt, bereich: Bereich): boolean =>
  'grenzen' in bereich
    ? p.lat >= bereich.grenzen.sued && p.lat <= bereich.grenzen.nord && p.lng >= bereich.grenzen.west && p.lng <= bereich.grenzen.ost
    : km(p, bereich.mitte) <= bereich.radiusKm;

/** Liegt im gesuchten Ort laut Adresse (Bezirk, Ortsteil, Stadt aus dem Salon-Verzeichnis) */
export const imOrt = (x: { bezirk?: string; ortsteil?: string; city?: string }, bereich: Bereich): boolean => {
  if ('grenzen' in bereich || !bereich.ort) return false;
  const name = normSuche(bereich.ort.name);
  const feld = bereich.ort.typ === 'bezirk' ? x.bezirk : bereich.ort.typ === 'ortsteil' ? x.ortsteil : bereich.ort.typ === 'stadt' ? x.city : '';
  return !!name && normSuche(feld) === name;
};

const drinnen = (x: { lat?: number | null; lng?: number | null; bezirk?: string; ortsteil?: string; city?: string }, bereich: Bereich) =>
  imOrt(x, bereich) || (hatLage(x) && imBereich(x, bereich));

const mitteVon = (bereich: Bereich): Punkt =>
  'grenzen' in bereich
    ? { lat: (bereich.grenzen.sued + bereich.grenzen.nord) / 2, lng: (bereich.grenzen.west + bereich.grenzen.ost) / 2 }
    : bereich.mitte;

/**
 * Vorschläge für „Wo?“ aus der eigenen Ortsliste: erst Namen, die so anfangen, dann solche, die es enthalten.
 * Heißen Bezirk und Ortsteil gleich (Mitte, Pankow …), bleibt der Bezirk. Fünf Ziffern: die Postleitzahl selbst.
 */
export const ortVorschlaege = (eingabe: string, orte: Ort[], max = 6): Ort[] => {
  const e = normSuche(eingabe);
  if (!e) return [];
  const eindeutig = new Map<string, Ort>();
  for (const o of orte) {
    const key = normSuche(o.name);
    const da = eindeutig.get(key);
    if (!da || (da.typ !== 'bezirk' && o.typ === 'bezirk')) eindeutig.set(key, o);
  }
  const alle = [...eindeutig.values()];
  const anfang = alle.filter((o) => normSuche(o.name).startsWith(e) || normSuche(o.name).split(' ').some((w) => w.startsWith(e)));
  const rest = alle.filter((o) => !anfang.includes(o) && normSuche(`${o.name} ${o.bezirk ?? ''}`).includes(e));
  const sortiert = [...anfang.sort((a, b) => a.name.localeCompare(b.name, 'de')), ...rest];
  return sortiert.slice(0, max);
};

/** Genau passender Ort aus der Liste (Adresse der Seite: ?wo=Pankow) */
export const ortAusListe = (name: string, orte: Ort[]): Ort | undefined => {
  const n = normSuche(name);
  if (!n) return undefined;
  const treffer = orte.filter((o) => normSuche(o.name) === n);
  return treffer.find((o) => o.typ === 'bezirk') ?? treffer[0];
};

export const istPlz = (text: string) => /^\d{5}$/.test(text.trim());

/**
 * Vorschläge für „Was?“: Leistungen (gleicher Name zählt einmal, häufige zuerst) und Läden nach Namen.
 * Ohne Eingabe die häufigsten Leistungen.
 */
export const wasVorschlaege = (eingabe: string, laeden: SuchLaden[], max = 5): { leistungen: string[]; laeden: SuchLaden[] } => {
  const zaehler = new Map<string, { name: string; n: number }>();
  for (const laden of laeden) {
    const schonGezaehlt = new Set<string>();
    for (const l of laden.leistungen) {
      const key = normSuche(l.name);
      if (!key || schonGezaehlt.has(key)) continue;
      schonGezaehlt.add(key);
      const da = zaehler.get(key);
      if (da) da.n += 1;
      else zaehler.set(key, { name: l.name.trim(), n: 1 });
    }
  }
  const e = normSuche(eingabe);
  const leistungen = [...zaehler.values()]
    .filter((x) => !e || passt(x.name, eingabe))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'de'))
    .map((x) => x.name)
    .slice(0, max);
  const passendeLaeden = e ? laeden.filter((l) => passt(l.name, eingabe)).slice(0, max) : [];
  return { leistungen, laeden: passendeLaeden };
};

// --- Öffnungszeiten ---------------------------------------------------------------------------------------------------

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Gerade geöffnet? Wie oeffnungJetzt in utils/laden-live.ts (dort mit Text); null ohne Öffnungszeiten */
export const offenJetzt = (laden: { businessHoursByDay?: Tag[] }, jetzt: Date): boolean | null => {
  const tage = laden.businessHoursByDay;
  if (!Array.isArray(tage) || tage.length === 0) return null;
  const tag = tage.find((d) => Number(d.dayOfWeek) === jetzt.getDay());
  if (!tag?.isOpen) return false;
  const uhr = hhmm(jetzt);
  if (uhr < (tag.openTime ?? '') || uhr >= (tag.closeTime ?? '')) return false;
  return !(tag.breaks ?? []).some((p) => (p.startTime ?? '') <= uhr && uhr < (p.endTime ?? ''));
};

const gleicherTag = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const terminHeute = (frei: Frei | undefined, jetzt: Date): boolean =>
  !!frei?.termine.some((t) => gleicherTag(new Date(t.start), jetzt));

// --- Ergebnis ---------------------------------------------------------------------------------------------------------

export type Treffer = { laden: SuchLaden; km: number | null; leistung?: Leistung };
export type SalonTreffer = { salon: SuchSalon; km: number | null };
export type Ergebnis = {
  /** im gesuchten Bereich (ohne Bereich: alle) */
  treffer: Treffer[];
  /** zu wenige im Bereich: die nächsten außerhalb */
  weiter: Treffer[];
  /** Salons ohne Dranzeit im Bereich (nur ohne Filter, deren Zeiten kennen wir nicht) */
  salons: SalonTreffer[];
  /** Diese Filter brauchen freie Zeiten, die noch nicht für alle Treffer da sind */
  wartetAufZeiten: boolean;
};

export type Anfrage = { was: string; bereich: Bereich | null; filter: Filter[]; sortierung: Sortierung };

const BRAUCHT_ZEITEN: Filter[] = ['heute', 'kurz'];

export const filterPasst = (t: Treffer, filter: Filter[], frei: Record<string, Frei>, jetzt: Date): boolean =>
  filter.every((f) => {
    const f2 = frei[t.laden.id];
    if (f === 'offen') return offenJetzt(t.laden, jetzt) === true;
    if (f === 'termine') return !!t.laden.termine;
    if (f === 'heute') return terminHeute(f2, jetzt);
    if (f === 'kurz') return offenJetzt(t.laden, jetzt) === true && !!f2 && f2.warten <= KURZ_WARTEN;
    return true;
  });

const preisVon = (t: Treffer) => t.leistung?.price || abPreis(t.laden) || Infinity;

export const sortieren = (liste: Treffer[], sortierung: Sortierung, frei: Record<string, Frei>, jetzt: Date): Treffer[] => {
  const entfernung = (t: Treffer) => t.km ?? Infinity;
  const name = (a: Treffer, b: Treffer) => a.laden.name.localeCompare(b.laden.name, 'de');
  const vergleich: Record<Sortierung, (a: Treffer, b: Treffer) => number> = {
    // Offen vor zu, dann wer heute noch etwas frei hat, dann die Nähe
    empfohlen: (a, b) => {
      const punkte = (t: Treffer) =>
        (offenJetzt(t.laden, jetzt) ? 0 : 2) + (frei[t.laden.id]?.nummer || terminHeute(frei[t.laden.id], jetzt) ? 0 : 1);
      return punkte(a) - punkte(b) || entfernung(a) - entfernung(b) || name(a, b);
    },
    entfernung: (a, b) => entfernung(a) - entfernung(b) || name(a, b),
    warten: (a, b) => (frei[a.laden.id]?.warten ?? Infinity) - (frei[b.laden.id]?.warten ?? Infinity) || entfernung(a) - entfernung(b) || name(a, b),
    preis: (a, b) => preisVon(a) - preisVon(b) || entfernung(a) - entfernung(b) || name(a, b),
  };
  return [...liste].sort(vergleich[sortierung]);
};

export const ergebnis = (
  laeden: SuchLaden[],
  salons: SuchSalon[],
  anfrage: Anfrage,
  frei: Record<string, Frei>,
  jetzt: Date,
): Ergebnis => {
  const { was, bereich, filter, sortierung } = anfrage;
  const mitte = bereich ? mitteVon(bereich) : null;
  const alle: Treffer[] = laeden
    .filter((l) => ladenPasst(l, was))
    .map((laden) => ({ laden, km: mitte && hatLage(laden) ? km(laden, mitte) : null, leistung: passendeLeistung(laden, was) }));
  const drin = bereich ? alle.filter((t) => drinnen(t.laden, bereich)) : alle;
  const gefiltert = drin.filter((t) => filterPasst(t, filter, frei, jetzt));
  let weiter: Treffer[] = [];
  if (bereich && gefiltert.length < MINDESTENS) {
    weiter = sortieren(
      alle.filter((t) => !drin.includes(t) && t.km !== null && t.km <= WEITER_KM && filterPasst(t, filter, frei, jetzt)),
      'entfernung',
      frei,
      jetzt,
    ).slice(0, MINDESTENS - gefiltert.length + 2);
  }
  const salonTreffer =
    filter.length > 0
      ? []
      : salons
          .filter((s) => !normSuche(was) || passt(`${s.name} ${s.leistungen.join(' ')}`, was))
          .filter((s) => !bereich || drinnen(s, bereich))
          .map((salon) => ({ salon, km: mitte ? km(salon, mitte) : null }))
          .sort((a, b) => (a.km ?? 0) - (b.km ?? 0) || a.salon.name.localeCompare(b.salon.name, 'de'));
  const wartetAufZeiten = filter.some((f) => BRAUCHT_ZEITEN.includes(f)) && drin.some((t) => !frei[t.laden.id]);
  return { treffer: sortieren(gefiltert, sortierung, frei, jetzt), weiter, salons: salonTreffer, wartetAufZeiten };
};

/** Für welche Läden die Seite freie Zeiten holt: erst die gezeigten, dann (für Filter) die übrigen im Bereich */
export const zeitenFuer = (laeden: SuchLaden[], anfrage: Anfrage, max = 12): string[] => {
  const mitte = anfrage.bereich ? mitteVon(anfrage.bereich) : null;
  return laeden
    .filter((l) => ladenPasst(l, anfrage.was))
    .filter((l) => !anfrage.bereich || (hatLage(l) && km(l, mitte as Punkt) <= WEITER_KM))
    .sort((a, b) => (mitte && hatLage(a) && hatLage(b) ? km(a, mitte) - km(b, mitte) : a.name.localeCompare(b.name, 'de')))
    .slice(0, max)
    .map((l) => l.id);
};

// --- Adresse der Seite --------------------------------------------------------------------------------------------------

export type Zustand = { was: string; wo: string; filter: Filter[]; sortierung: Sortierung };

export const zustandAus = (params: URLSearchParams): Zustand => ({
  was: (params.get('was') ?? '').slice(0, 80),
  wo: (params.get('wo') ?? '').slice(0, 80),
  filter: (params.get('filter') ?? '').split(',').filter((f): f is Filter => (FILTER as string[]).includes(f)),
  sortierung: (SORTIERUNGEN as string[]).includes(params.get('sort') ?? '') ? (params.get('sort') as Sortierung) : 'empfohlen',
});

/** Nur was jemand eingegeben hat; andere Angaben (z. B. ?shopId) bleiben erhalten */
export const zustandParams = (z: Zustand, alt?: URLSearchParams): URLSearchParams => {
  const p = new URLSearchParams(alt);
  const setze = (k: string, v: string) => (v ? p.set(k, v) : p.delete(k));
  setze('was', z.was.trim());
  setze('wo', z.wo.trim());
  setze('filter', z.filter.join(','));
  setze('sort', z.sortierung === 'empfohlen' ? '' : z.sortierung);
  return p;
};
