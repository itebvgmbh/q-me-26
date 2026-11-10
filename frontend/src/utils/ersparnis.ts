// Ersparnis-Rechner (pages/Rechner.tsx): Was ein Laden mit Dranzeit im Monat gewinnt, abzüglich Abo und Telefon-Assistent.
// Reine Rechnung ohne Importe aus der App, damit dev/ersparnis.test.mjs sie ohne Browser prüfen kann. Die Preise gibt die
// Seite aus utils/plans.ts und utils/telefon-assistent.ts hinein. Alle Beträge netto, je Monat.

/** 52 Wochen auf 12 Monate */
export const WOCHEN_JE_MONAT = 52 / 12;

export interface Eingaben {
  /** Leute, die gleichzeitig Kunden bedienen – bestimmt den Tarif */
  personen: number;
  tageJeWoche: number;
  /** netto in Euro */
  umsatzJeKunde: number;
  minutenJeKunde: number;

  telefon: boolean;
  /** Anrufe am Tag im ganzen Laden */
  anrufeJeTag: number;
  /** So lange holt ein Anruf jemanden vom Stuhl: hingehen, Hände abwischen, Kalender, zurück zum Kunden */
  minutenJeAnruf: number;
  /** 0 bis 1: So viel der Zeit vom Telefon wird zu Kundenzeit (an vollen Tagen fast alles, an ruhigen wenig) */
  anteilKundenzeit: number;
  /** Anrufer pro Woche, die niemanden erreichen und woanders buchen – die nimmt der Assistent an */
  verpassteJeWoche: number;
  /** So lange spricht der Assistent je Anruf; zählt für die Minuten im Tarif */
  gespraechMinuten: number;

  nachruecken: boolean;
  /** Absagen, No-Shows und Lücken pro Woche im ganzen Laden */
  lueckenJeWoche: number;
  /** 0 bis 1: So viele davon besetzen Schlange und „Früher dran“ neu */
  anteilNachbesetzt: number;
}

export interface Tarif {
  id: string;
  /** netto je Monat */
  monthly: number;
  maxStaff: number;
}

export interface TelefonPreis {
  grundpreis: number;
  inklusiv: number;
  minute: number;
}

export interface Ergebnis {
  tarif: Tarif;
  tageJeMonat: number;
  telefon: null | {
    stunden: number;
    kundenAusZeit: number;
    umsatzAusZeit: number;
    kundenAusVerpassten: number;
    umsatzAusVerpassten: number;
    /** Gesprächsminuten des Assistenten im Monat */
    minuten: number;
    kosten: number;
  };
  nachruecken: null | { kunden: number; umsatz: number };
  mehrKunden: number;
  mehrUmsatz: number;
  /** Abo plus Telefon-Assistent */
  kosten: number;
  plusMonat: number;
  plusJahr: number;
  /** So viele zusätzliche Kunden im Monat zahlen Dranzeit */
  kundenFuerKosten: number;
}

export const STANDARD: Eingaben = {
  personen: 2,
  tageJeWoche: 5,
  umsatzJeKunde: 25,
  minutenJeKunde: 30,
  telefon: true,
  anrufeJeTag: 10,
  minutenJeAnruf: 3,
  anteilKundenzeit: 0.5,
  verpassteJeWoche: 2,
  gespraechMinuten: 1.5,
  nachruecken: true,
  lueckenJeWoche: 4,
  anteilNachbesetzt: 0.5,
};

const nichtNegativ = (wert: number) => (Number.isFinite(wert) && wert > 0 ? wert : 0);
const anteil = (wert: number) => Math.min(1, nichtNegativ(wert));

/** Kleinster bezahlter Tarif, in den so viele Leute passen; mehr als im größten: der größte.
 *  Telefon-Assistent und „Früher dran“ gibt es erst ab Solo, deshalb nie Gratis. */
export function tarifFuer(personen: number, tarife: Tarif[]): Tarif {
  const bezahlt = tarife.filter((t) => t.monthly > 0).sort((a, b) => a.maxStaff - b.maxStaff || a.monthly - b.monthly);
  if (!bezahlt.length) throw new Error('Keine bezahlten Tarife');
  return bezahlt.find((t) => Math.max(1, personen) <= t.maxStaff) ?? bezahlt[bezahlt.length - 1];
}

export function telefonKosten(minuten: number, preis: TelefonPreis): number {
  return preis.grundpreis + Math.max(0, nichtNegativ(minuten) - preis.inklusiv) * preis.minute;
}

export function rechne(e: Eingaben, tarife: Tarif[], telefonPreis: TelefonPreis): Ergebnis {
  const tarif = tarifFuer(e.personen, tarife);
  const tageJeMonat = nichtNegativ(e.tageJeWoche) * WOCHEN_JE_MONAT;
  const umsatz = nichtNegativ(e.umsatzJeKunde);
  const dauer = nichtNegativ(e.minutenJeKunde);

  let telefon: Ergebnis['telefon'] = null;
  if (e.telefon) {
    const anrufe = nichtNegativ(e.anrufeJeTag) * tageJeMonat;
    const minutenZurueck = anrufe * nichtNegativ(e.minutenJeAnruf);
    const kundenAusZeit = dauer > 0 ? (minutenZurueck * anteil(e.anteilKundenzeit)) / dauer : 0;
    const kundenAusVerpassten = nichtNegativ(e.verpassteJeWoche) * WOCHEN_JE_MONAT;
    const minuten = anrufe * nichtNegativ(e.gespraechMinuten);
    telefon = {
      stunden: minutenZurueck / 60,
      kundenAusZeit,
      umsatzAusZeit: kundenAusZeit * umsatz,
      kundenAusVerpassten,
      umsatzAusVerpassten: kundenAusVerpassten * umsatz,
      minuten,
      kosten: telefonKosten(minuten, telefonPreis),
    };
  }

  let nachruecken: Ergebnis['nachruecken'] = null;
  if (e.nachruecken) {
    const kunden = nichtNegativ(e.lueckenJeWoche) * WOCHEN_JE_MONAT * anteil(e.anteilNachbesetzt);
    nachruecken = { kunden, umsatz: kunden * umsatz };
  }

  const mehrKunden = (telefon ? telefon.kundenAusZeit + telefon.kundenAusVerpassten : 0) + (nachruecken?.kunden ?? 0);
  const mehrUmsatz = mehrKunden * umsatz;
  const kosten = tarif.monthly + (telefon?.kosten ?? 0);
  const plusMonat = mehrUmsatz - kosten;
  return {
    tarif,
    tageJeMonat,
    telefon,
    nachruecken,
    mehrKunden,
    mehrUmsatz,
    kosten,
    plusMonat,
    plusJahr: plusMonat * 12,
    kundenFuerKosten: umsatz > 0 ? Math.ceil(kosten / umsatz) : 0,
  };
}
