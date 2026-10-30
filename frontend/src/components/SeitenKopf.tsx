import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  ALIASE,
  canonicalUrl,
  EIGENER_KOPF,
  normalisiere,
  OEFFENTLICHE_SEITEN,
  setzeKopf,
  STANDARD_KOPF,
} from '../utils/seiten-kopf';

/**
 * Titel, Beschreibung und Canonical je Seite (utils/seiten-kopf.ts). Seiten außerhalb der Liste – Konto, Tresen,
 * Buchung, 404 – bekommen "noindex". Steht vor dem Seiteninhalt, damit Seiten mit eigenem Titel (Nummer) ihn danach setzen.
 */
export function SeitenKopf() {
  const { pathname } = useLocation();
  useEffect(() => {
    const pfad = normalisiere(pathname);
    // Bis die Seite ihren eigenen Kopf setzt, nichts von der vorigen Seite stehen lassen
    if (EIGENER_KOPF.has(pfad)) return setzeKopf({ ...STANDARD_KOPF, canonical: null, robots: null });
    const ziel = ALIASE[pfad] ?? pfad;
    const kopf = OEFFENTLICHE_SEITEN[ziel];
    if (kopf) setzeKopf({ ...kopf, canonical: canonicalUrl(ziel), robots: null });
    else setzeKopf({ ...STANDARD_KOPF, canonical: null, robots: 'noindex' });
  }, [pathname]);
  return null;
}
