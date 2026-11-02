import { useEffect, useState } from 'react';

let laeden: Promise<Set<string>> | null = null;

/** Läden, bei denen man per Telefon buchen kann: Nur die IDs, einmal je Seitenaufruf (backend/app/apis/telefon_hinweis) */
const ladeLaeden = () => {
  if (!laeden) {
    laeden = fetch('/routes/telefon-hinweis')
      .then((res) => (res.ok ? (res.json() as Promise<{ laeden?: string[] }>) : {}))
      .then((daten) => new Set(daten.laeden ?? []))
      .catch(() => new Set<string>());
  }
  return laeden;
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
