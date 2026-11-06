import { useEffect, useState } from 'react';

let hinweis: Promise<{ laeden: Set<string>; offen: boolean }> | null = null;

/** Läden, bei denen man per Telefon buchen kann (nur die IDs), und ob der Assistent für alle Läden offen ist.
 *  Einmal je Seitenaufruf (backend/app/apis/telefon_hinweis) */
const ladeHinweis = () => {
  if (!hinweis) {
    hinweis = fetch('/routes/telefon-hinweis')
      .then((res) => (res.ok ? (res.json() as Promise<{ laeden?: string[]; offen?: boolean }>) : {}))
      .then((daten: { laeden?: string[]; offen?: boolean }) => ({ laeden: new Set<string>(daten.laeden ?? []), offen: Boolean(daten.offen) }))
      .catch(() => ({ laeden: new Set<string>(), offen: false }));
  }
  return hinweis;
};
const ladeLaeden = () => ladeHinweis().then((h) => h.laeden);

/** Kann jeder Laden den Assistenten selbst testen und zubuchen? (Preise-Seite) */
export const useTelefonOffen = (): boolean => {
  const [offen, setOffen] = useState(false);
  useEffect(() => {
    let aktuell = true;
    ladeHinweis().then((h) => aktuell && setOffen(h.offen));
    return () => {
      aktuell = false;
    };
  }, []);
  return offen;
};

/** Landet ein Anruf auf die Nummer dieses Ladens beim Telefon-Assistenten, und kann er dort buchen? */
export const useTelefonAnnahme = (shopId?: string | null): boolean => {
  const [annahme, setAnnahme] = useState(false);
  useEffect(() => {
    setAnnahme(false);
    if (!shopId) return;
    let aktuell = true;
    ladeLaeden().then((ids) => aktuell && setAnnahme(ids.has(shopId)));
    return () => {
      aktuell = false;
    };
  }, [shopId]);
  return annahme;
};

export const telLink = (nummer: string) => `tel:${nummer.replace(/[^\d+]/g, '')}`;
