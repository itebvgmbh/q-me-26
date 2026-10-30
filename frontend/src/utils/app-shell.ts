/**
 * Läuft Dranzeit gerade in der App aus Google Play oder dem App Store? Dort wird nichts verkauft: kein Abo
 * abschließen, keine Preise von Dranzeit, keine Knöpfe oder Links dorthin. Google Play verlangt sonst die
 * Abrechnung über Google, Apple lässt eine kostenlose Begleit-App nur ohne Kauf und ohne Hinweis auf einen
 * Kauf zu (App Review Guidelines 3.1.3(f)). Abos gibt es nur im Browser.
 *
 * Erkannt wird
 * - Android (Trusted Web Activity, android/): Start-Adresse /?app=android. Öffnet ein Link die App,
 *   setzt Chrome document.referrer auf android-app://de.dranzeit.app.
 * - iOS (Capacitor): Start-Adresse /?app=ios und "DranzeitApp/ios" im User-Agent.
 *
 * Gemerkt in sessionStorage, nicht in localStorage: Die Android-App teilt den Speicher mit Chrome, sonst
 * fehlten Tarif und Preise danach auch im normalen Browser. Hilfe- und Stadtseiten vom Server erkennen die
 * App genauso (backend/app/seo.py, APP_JS) – Änderungen an beiden Stellen.
 */

export type AppPlatform = 'android' | 'ios';

const SPEICHER = 'dranzeit:app';
const ANDROID_PAKET = 'de.dranzeit.app';

const istPlatform = (wert: unknown): wert is AppPlatform => wert === 'android' || wert === 'ios';

const erkennen = (): AppPlatform | null => {
  const ausAdresse = new URLSearchParams(window.location.search).get('app');
  if (istPlatform(ausAdresse)) return ausAdresse;
  if (document.referrer.startsWith(`android-app://${ANDROID_PAKET}`)) return 'android';
  if (/\bDranzeitApp\/ios\b/.test(navigator.userAgent)) return 'ios';
  return null;
};

let platform: AppPlatform | null | undefined;

/** Beim Start einmal aufrufen (main.tsx), solange ?app= noch in der Adresse steht */
export const appPlatform = (): AppPlatform | null => {
  if (platform !== undefined) return platform;
  let gemerkt: string | null = null;
  try {
    gemerkt = sessionStorage.getItem(SPEICHER);
  } catch {
    // ohne Speicher (privates Fenster, gesperrt): nur diese Seite erkennen
  }
  platform = istPlatform(gemerkt) ? gemerkt : erkennen();
  if (platform && !gemerkt) {
    try {
      sessionStorage.setItem(SPEICHER, platform);
    } catch {
      // siehe oben
    }
  }
  return platform;
};

export const inStoreApp = () => appPlatform() !== null;
