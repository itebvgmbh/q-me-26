/** Nimmt der Telefon-Assistent ab, wenn man die Nummer auf der Ladenseite anruft? Nur Ja oder Nein (backend/app/apis/telefon_hinweis) */
export const ladeTelefonHinweis = async (shopId: string): Promise<boolean> => {
  try {
    const res = await fetch(`/routes/telefon-hinweis/${encodeURIComponent(shopId)}`);
    if (!res.ok) return false;
    return ((await res.json()) as { annahme?: boolean }).annahme === true;
  } catch {
    return false;
  }
};
