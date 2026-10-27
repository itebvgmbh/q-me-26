import { createElement, Fragment, type ReactNode } from "react";
import type { Locale } from "date-fns";
// Direkt statt aus "date-fns/locale": Sonst zählt der Bündler auch die anderen Sprachen zum Einstieg
import { de } from "date-fns/locale/de";
import { einmalNeuLaden } from "../utils/lazy-page";
import type { Sprache, Texte } from "./typen";

export type { Sprache, Texte, Mehrzahl } from "./typen";

/**
 * Mehrsprachigkeit: Der deutsche Text im Code ist zugleich der Schlüssel (t("Speichern")).
 * Deutsch braucht deshalb keinen Katalog; Englisch, Türkisch und Arabisch werden nur geladen,
 * wenn sie gebraucht werden. Fehlt eine Übersetzung, steht der deutsche Text da.
 * Prüfen, ob alles übersetzt ist: node --experimental-strip-types dev/i18n-pruefen.mjs
 */

export const SPRACHEN: { code: Sprache; name: string; intl: string; rtl?: boolean }[] = [
  { code: "de", name: "Deutsch", intl: "de-DE" },
  { code: "en", name: "English", intl: "en-GB" },
  { code: "tr", name: "Türkçe", intl: "tr-TR" },
  // Westliche Ziffern wie auf Nummern, Bildschirm und Plakat im Laden
  { code: "ar", name: "العربية", intl: "ar-u-nu-latn", rtl: true },
];

const SPEICHER = "dranzeit:sprache";

const LADER: Record<Exclude<Sprache, "de">, () => Promise<{ texte: Texte; datumsLocale: Locale }>> = {
  en: () => import("./en/index.ts"),
  tr: () => import("./tr/index.ts"),
  ar: () => import("./ar/index.ts"),
};

let aktuell: Sprache = "de";
let texte: Texte = {};
let datum: Locale = de;

const istSprache = (wert: unknown): wert is Sprache => SPRACHEN.some((s) => s.code === wert);
const eintrag = () => SPRACHEN.find((s) => s.code === aktuell) ?? SPRACHEN[0];

const gespeicherteSprache = (): Sprache | null => {
  try {
    const wert = localStorage.getItem(SPEICHER);
    return istSprache(wert) ? wert : null;
  } catch {
    return null;
  }
};

const ermittleSprache = (): Sprache => {
  // ?sprache=tr: für Geräte ohne Sprachwahl, z. B. den Bildschirm im Laden
  const ausAdresse = new URLSearchParams(window.location.search).get("sprache");
  if (istSprache(ausAdresse)) return ausAdresse;
  const gespeichert = gespeicherteSprache();
  if (gespeichert) return gespeichert;
  // Bildschirm und Plakat sind für alle Kunden im Laden, nicht für den, dem das Gerät gehört
  if (/^\/(bildschirm|plakat)(\/|$)/.test(window.location.pathname)) return "de";
  // Suchmaschinen rendern mit englischem Browser – sie sollen die deutsche Seite sehen wie im Seitenkopf
  if (/bot\b|bot\/|crawl|spider|slurp|lighthouse/i.test(navigator.userAgent)) return "de";
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const code = (tag || "").slice(0, 2).toLowerCase();
    if (istSprache(code)) return code;
  }
  return "de";
};

/** Vor dem ersten Zeichnen aufrufen (main.tsx), damit nichts erst auf Deutsch aufblitzt */
export async function starteSprache(): Promise<void> {
  const gewuenscht = ermittleSprache();
  if (gewuenscht !== "de") {
    try {
      const katalog = await LADER[gewuenscht]();
      texte = katalog.texte;
      datum = katalog.datumsLocale;
      aktuell = gewuenscht;
    } catch (fehler) {
      // Nach einem Ausrollen gibt es die Sprachdatei der alten Fassung nicht mehr: einmal neu laden.
      // Klappt das nicht (keine Verbindung), lieber Deutsch als gar nichts.
      if (einmalNeuLaden()) await new Promise<never>(() => {});
      console.error("Sprache konnte nicht geladen werden", fehler);
    }
  }
  const html = document.documentElement;
  html.lang = aktuell;
  html.dir = eintrag().rtl ? "rtl" : "ltr";
}

/** Neu laden statt umschalten: So stimmt jeder Text, auch in schon geladenen Seiten und Konstanten */
export function wechsleSprache(neu: Sprache): void {
  const adresse = new URL(window.location.href);
  adresse.searchParams.delete("sprache");
  try {
    localStorage.setItem(SPEICHER, neu);
  } catch {
    // Ohne Speicher (privates Fenster) gilt die Wahl über die Adresse
    adresse.searchParams.set("sprache", neu);
  }
  window.location.replace(adresse.toString());
}

export const sprache = (): Sprache => aktuell;
export const istRtl = (): boolean => Boolean(eintrag().rtl);
/** Für Intl und toLocaleString: "de-DE", "en-GB", "tr-TR", "ar-u-nu-latn" */
export const intlSprache = (): string => eintrag().intl;
/** Für date-fns: format(datum, t("EEEE, d. MMMM"), { locale: datumsLocale() }) */
export const datumsLocale = (): Locale => datum;

export type Werte = Record<string, string | number>;

const fuelle = (text: string, werte?: Werte): string =>
  werte ? text.replace(/\{(\w+)\}/g, (platzhalter, name) => (name in werte ? String(werte[name]) : platzhalter)) : text;

/** Übersetzt einen deutschen Text; Platzhalter in geschweiften Klammern: t("Hallo {name}", { name }) */
export function t(text: string, werte?: Werte): string {
  const uebersetzt = texte[text];
  if (uebersetzt === undefined) return fuelle(text, werte);
  return fuelle(typeof uebersetzt === "string" ? uebersetzt : uebersetzt.other, werte);
}

/** Text mit Anzahl: tn(n, "{n} Termin", "{n} Termine"). Schlüssel im Katalog ist die Mehrzahl. */
export function tn(anzahl: number, einzahl: string, mehrzahl: string, werte?: Werte): string {
  const alle = { n: anzahl, ...werte };
  const uebersetzt = aktuell === "de" ? undefined : texte[mehrzahl];
  if (uebersetzt === undefined) return fuelle(anzahl === 1 ? einzahl : mehrzahl, alle);
  if (typeof uebersetzt === "string") return fuelle(uebersetzt, alle);
  const form = new Intl.PluralRules(eintrag().intl).select(anzahl);
  return fuelle(uebersetzt[form] ?? uebersetzt.other, alle);
}

/**
 * Text mit eingebetteten Elementen, damit jede Sprache ihre eigene Wortstellung behält:
 * tTeile("Mit dem Anmelden gelten die <agb>AGB</agb>.", { agb: (inhalt) => <Link to="/agb">{inhalt}</Link> })
 * Ohne Inhalt: "Tippe auf <symbol/>" mit { symbol: () => <Share /> }
 */
export function tTeile(text: string, teile: Record<string, (inhalt: string) => ReactNode>, werte?: Werte): ReactNode {
  const fertig = t(text, werte);
  const stuecke: ReactNode[] = [];
  let bis = 0;
  for (const treffer of fertig.matchAll(/<(\w+)\/>|<(\w+)>(.*?)<\/\2>/gs)) {
    const start = treffer.index ?? 0;
    if (start > bis) stuecke.push(fertig.slice(bis, start));
    const name = treffer[1] ?? treffer[2];
    const inhalt = treffer[3] ?? "";
    const teil = teile[name];
    stuecke.push(createElement(Fragment, { key: stuecke.length }, teil ? teil(inhalt) : inhalt));
    bis = start + treffer[0].length;
  }
  if (bis < fertig.length) stuecke.push(fertig.slice(bis));
  return createElement(Fragment, null, ...stuecke);
}

/**
 * Markiert Text für die Übersetzung, ohne ihn schon zu übersetzen – für Konstanten auf Modulebene,
 * die beim Laden der Datei entstehen. Angezeigt wird er später mit t(wert).
 */
export const merke = <T extends string>(text: T): T => text;
