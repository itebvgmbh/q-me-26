// Telefon-Assistent einrichten (/telefon-assistent). Backend: backend/app/apis/telefon_einrichtung
import { useEffect, useState } from 'react';
import { send } from './betreiber';

export interface TelefonStand {
  /** Der Betreiber hat den Laden zugelassen */
  freigegeben: boolean;
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
  minuten: number;
  freiminuten: number;
}

const pfad = (shopId: string) => `/routes/telefon-einrichtung/${encodeURIComponent(shopId)}`;

export const ladeTelefon = (shopId: string) => send<TelefonStand>(pfad(shopId));

export const speichereTelefon = (shopId: string, aktiv: boolean, anschluss: string) => send<TelefonStand>(pfad(shopId), { aktiv, anschluss });

/** Rufnummer zum Wählen: +49… als 0… */
export const zumWaehlen = (nummer: string) => nummer.replace(/^\+49/, '0');

/** Nummer in Hinweisen an Kunden: die umgeleitete, so geschrieben wie in den Ladendaten, wenn es dieselbe ist */
export const nummerFuerKunden = (stand: TelefonStand, telefon = '') =>
  !stand.anschluss || stand.vorschlag === stand.anschluss ? telefon : zumWaehlen(stand.anschluss);

/** Für die Kachel unter „Laden“: Der Assistent ist nur für zugelassene Läden zu sehen */
export const useTelefonFreigegeben = (shopId: string): boolean => {
  const [freigegeben, setFreigegeben] = useState(false);
  useEffect(() => {
    let aktuell = true;
    setFreigegeben(false);
    if (shopId) {
      ladeTelefon(shopId)
        .then((stand) => aktuell && setFreigegeben(stand.freigegeben))
        .catch(() => undefined);
    }
    return () => {
      aktuell = false;
    };
  }, [shopId]);
  return freigegeben;
};
