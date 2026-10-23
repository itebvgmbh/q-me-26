import { type ComponentType, lazy } from "react";

// Nach einem Ausrollen gibt es die Bausteine der alten Fassung nicht mehr. Wer die Seite vorher
// geöffnet hat, bekäme beim Weiterklicken „Failed to fetch dynamically imported module“.
// Dann einmal neu laden: Das holt die neue index.html mit den neuen Bausteinen.
const SCHLUESSEL = "dranzeit:neu-geladen";
// Schlägt es kurz nach dem Neuladen wieder fehl, liegt es nicht an einer alten Fassung –
// dann die Fehlerseite zeigen statt endlos neu zu laden.
const SPERRE_MS = 30_000;

export const einmalNeuLaden = (): boolean => {
  try {
    const zuletzt = Number(sessionStorage.getItem(SCHLUESSEL) || 0);
    if (Date.now() - zuletzt < SPERRE_MS) return false;
    sessionStorage.setItem(SCHLUESSEL, String(Date.now()));
  } catch {
    // Ohne sessionStorage keine Sperre gegen Endlosschleifen, also lieber nicht automatisch
    return false;
  }
  window.location.reload();
  return true;
};

// Wie React.lazy, lädt aber bei fehlendem Baustein einmal die Seite neu
export const lazyPage = <T extends ComponentType<any>>(laden: () => Promise<{ default: T }>) =>
  lazy(() =>
    laden().catch((fehler) => {
      // Bis das Neuladen greift, bleibt die Ladeanzeige stehen
      if (einmalNeuLaden()) return new Promise<never>(() => {});
      throw fehler;
    }),
  );
