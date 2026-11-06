// Telefon-Assistent einrichten, testen und zubuchen (/telefon-assistent). Backend: backend/app/apis/telefon_einrichtung,
// Regeln und Preise: backend/app/libs/telefon.py (gleiche Zahlen wie hier), Abrechnung: backend/app/libs/telefon_abrechnung.py
import { useEffect, useState } from 'react';
import { send } from './betreiber';

/** Preis des Zusatzes, netto (Stefan, 02.11.2026). Gleich wie backend/app/libs/telefon.py */
export const TELEFON_PREIS = { grundpreis: 29, inklusiv: 100, minute: 0.2, testminuten: 30, deckel: 59, deckelMin: 29, deckelMax: 500 };

/** Warum der Assistent gerade nicht abnimmt (Anrufer hören dann eine kurze Ansage), null: er nimmt ab */
export type TelefonGrund = 'gesperrt' | 'aus' | 'nicht_frei' | 'test_verbraucht' | 'deckel' | 'gekuendigt' | 'zahlung' | null;

export interface TelefonVerbrauch {
  /** test: Testminuten insgesamt; zusatz: Minuten im laufenden Abrechnungsmonat bis zum Deckel */
  art: 'test' | 'zusatz';
  minuten: number;
  /** Testminuten oder Minuten bis zum Deckel */
  grenze: number;
  anteil: number;
  /** nur beim Zusatz: Kosten des Monats bis jetzt, netto in Cent */
  kostenCent?: number;
  deckel?: number;
}

export interface TelefonStand {
  /** Kachel unter „Laden“ zeigen: für alle geöffnet oder schon freigegeben, getestet, gebucht */
  sichtbar: boolean;
  /** Der Betreiber hat den Assistenten für alle Läden geöffnet */
  offen: boolean;
  /** Darf eingerichtet werden: Testminuten freigegeben oder Zusatz gebucht */
  freigegeben: boolean;
  gesperrt: boolean;
  /** Der Tarif erlaubt den Assistenten (ab Solo, in der Testphase alles) */
  tarif: boolean;
  /** Laufendes Abo ab Solo: Voraussetzung zum Zubuchen */
  abo: boolean;
  kannTesten: boolean;
  kannBuchen: boolean;
  /** Der Laden bucht in der Stripe-Sandbox (Betreiber-Bereich) */
  testmodus: boolean;
  zusatz: { status: string; kuendigtZum: string | null; periodeEnde: string | null } | null;
  grund: TelefonGrund;
  verbrauch: TelefonVerbrauch;
  /** 0, 80 oder 100 (Prozent der Testminuten oder des Deckels) */
  warnung: number;
  /** Kostendeckel je Monat in Euro netto */
  deckel: number;
  /** Der Inhaber hat ihn eingeschaltet */
  aktiv: boolean;
  /** Er nimmt gerade ab und kann Termine buchen: Nur dann gibt es Texte für die Kunden */
  weitersagen: boolean;
  /** wartet: auf den Probeanruf; aktiv: Anrufe von der Ladennummer kamen schon an */
  status: 'aus' | 'wartet' | 'aktiv';
  /** Nummer des Ladens, die auf uns umleitet */
  anschluss: string;
  /** Telefonnummer aus den Ladendaten, zum Vorbelegen */
  vorschlag: string;
  /** Nummer, auf die der Laden umleitet */
  zielnummer: string;
  /** Der Laden hat eine Nummer nur für sich, dann ist keine Ladennummer nötig */
  eigeneNummer: boolean;
  /** Gesprächsminuten insgesamt und Testminuten (Betreiber-Bereich) */
  minuten: number;
  freiminuten: number;
}

const pfad = (shopId: string, aktion = '') => `/routes/telefon-einrichtung/${encodeURIComponent(shopId)}${aktion ? `/${aktion}` : ''}`;

export const ladeTelefon = (shopId: string) => send<TelefonStand>(pfad(shopId));

export const speichereTelefon = (shopId: string, aktiv: boolean, anschluss: string) => send<TelefonStand>(pfad(shopId), { aktiv, anschluss });

/** 30 Testminuten selbst starten (erst, wenn der Betreiber für alle geöffnet hat) */
export const starteTest = (shopId: string) => send<TelefonStand>(pfad(shopId, 'testen'), {});

export const speichereDeckel = (shopId: string, deckel: number) => send<TelefonStand>(pfad(shopId, 'deckel'), { deckel });

/** Weiter zu Stripe: Zusatz buchen (oder ins Kundenportal, wenn er schon läuft) */
export const bucheZusatz = async (shopId: string) => {
  const { url } = await send<{ url: string }>(pfad(shopId, 'buchen'), {});
  window.location.assign(url);
};

/** Zum Monatsende kündigen, mit zurueck die Kündigung zurücknehmen */
export const kuendigeZusatz = (shopId: string, zurueck = false) => send<TelefonStand>(pfad(shopId, 'kuendigen'), { zurueck });

/** Rufnummer zum Wählen: +49… als 0… */
export const zumWaehlen = (nummer: string) => nummer.replace(/^\+49/, '0');

/** Nummer in Hinweisen an Kunden: die umgeleitete, so geschrieben wie in den Ladendaten, wenn es dieselbe ist */
export const nummerFuerKunden = (stand: TelefonStand, telefon = '') =>
  !stand.anschluss || stand.vorschlag === stand.anschluss ? telefon : zumWaehlen(stand.anschluss);

/** Stand für Kachel und Hinweise; null, solange er lädt oder wenn er nicht zu lesen ist (z. B. kein Inhaber) */
export const useTelefonStand = (shopId: string): TelefonStand | null => {
  const [stand, setStand] = useState<TelefonStand | null>(null);
  useEffect(() => {
    let aktuell = true;
    setStand(null);
    if (shopId) {
      ladeTelefon(shopId)
        .then((neu) => aktuell && setStand(neu))
        .catch(() => undefined);
    }
    return () => {
      aktuell = false;
    };
  }, [shopId]);
  return stand;
};
