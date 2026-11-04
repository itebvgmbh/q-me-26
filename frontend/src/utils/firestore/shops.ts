import { Shop } from './types';
import { backendSenden, liveLesen, LiveFehlt } from '../live';

/**
 * Läden über das Backend (requirements/eigene-datenbank.md, Stufe 2; backend/app/libs/laeden.py).
 * - Öffentlich (Läden finden, Buchen, Nummer ziehen): ohne Inhaber-Konto, Startklar-Merker und Onboarding-Mails.
 * - Inhaber und Team: der ganze Laden (getTeamShop, eigene Läden).
 * Anlegen nur als Gratis-Laden mit Testphase – die Tarif-Felder setzt das Backend; ändern nur der Inhaber.
 */

const oderNull = async <T,>(lesen: () => Promise<T>): Promise<T | null> => {
  try {
    return await lesen();
  } catch (error) {
    if (!(error instanceof LiveFehlt)) console.error('Laden nicht geladen:', error);
    return null;
  }
};

/** Öffentlich; null, wenn es den Laden nicht gibt */
export const getShopById = (shopId: string): Promise<Shop | null> =>
  oderNull(async () => (await liveLesen<{ laden: Shop }>(`live/laden/${encodeURIComponent(shopId)}`)).laden);

/** Für Inhaber und Team: der ganze Laden (Tarif, Startklar-Merker) */
export const getTeamShop = (shopId: string): Promise<Shop | null> =>
  oderNull(async () => (await liveLesen<{ laden: Shop }>(`team/laeden/${encodeURIComponent(shopId)}`, true)).laden);

/** Früher: ID oder Inhaber-Konto. Termine tragen die ID des Ladens, also reicht der Laden zur ID. */
export const getShopByOwner = (idOrOwner: string): Promise<Shop | null> => getShopById(idOrOwner);

export const createShop = async (_ownerId: string, shopData: Omit<Shop, 'id' | 'owner' | 'createdAt' | 'updatedAt'>): Promise<Shop> =>
  (await backendSenden<{ laden: Shop }>('team/laeden', { laden: shopData })).laden;

export const updateShop = async (shopId: string, shopData: Partial<Omit<Shop, 'id' | 'owner' | 'createdAt' | 'updatedAt'>>): Promise<Shop> =>
  (await backendSenden<{ laden: Shop }>(`team/laeden/${encodeURIComponent(shopId)}`, { aenderung: shopData })).laden;

/** Läden des angemeldeten Kontos; wirft bei Fehlern (getShopsByOwnerId liefert dann [] – "kein Laden" wäre falsch) */
export const listShopsOfOwner = async (_ownerId: string): Promise<Shop[]> =>
  (await liveLesen<{ laeden: Shop[] }>('team/ich/laeden', true)).laeden;

export const getShopsByOwnerId = async (ownerId: string): Promise<Shop[]> => {
  try {
    return await listShopsOfOwner(ownerId);
  } catch (error) {
    console.error('Error getting shops by owner:', error);
    return [];
  }
};

/** Alle Läden, die man buchen kann (ohne vom Betreiber gesperrte) */
export const getShops = async (): Promise<Shop[]> =>
  (await liveLesen<{ laeden: Shop[] }>('live/laeden')).laeden.filter((s) => !s.suspended);

/** Alle Läden in der öffentlichen Fassung, auch gesperrte (die Aufrufer filtern selbst) */
export const getAllPublicShops = async (): Promise<Shop[]> => (await liveLesen<{ laeden: Shop[] }>('live/laeden')).laeden;
