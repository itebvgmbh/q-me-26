/**
 * Welcher Laden eines Inhabers gerade gewählt ist – auf allen Seiten derselbe (Heute, Kalender, Laden, Team, Tarif …).
 * Reihenfolge: ?shopId= aus der Adresse, sonst der zuletzt auf diesem Gerät gezeigte, sonst der erste nicht gesperrte,
 * sonst der erste. Gemerkt nur in diesem Browser (localStorage), wie die Geräte-Rolle (utils/geraet.ts).
 */
const SPEICHER = 'dranzeit-laden';

export const merkeLaden = (shopId: string) => {
  try {
    localStorage.setItem(SPEICHER, shopId);
  } catch {
    /* privater Modus: dann zählt nur die Reihenfolge */
  }
};

const gemerkterLaden = (): string | null => {
  try {
    return localStorage.getItem(SPEICHER);
  } catch {
    return null;
  }
};

export const waehleLaden = <T extends { id: string; suspended?: unknown }>(
  shops: T[],
  wanted: string | null = new URLSearchParams(window.location.search).get('shopId'),
): T | undefined => {
  const gemerkt = gemerkterLaden();
  return shops.find((s) => s.id === wanted) ?? shops.find((s) => s.id === gemerkt) ?? shops.find((s) => !s.suspended) ?? shops[0];
};
