import { Service } from './types';
import { backendSenden, liveLesen, LiveFehlt } from '../live';

/**
 * Leistungen über das Backend (requirements/eigene-datenbank.md, Stufe 2; backend/app/apis/team_laden und
 * backend/app/apis/live). Lesen ist öffentlich (Buchen, Nummer ziehen, Ladenseite), pflegen darf nur der Inhaber –
 * wie bisher in firestore.rules.
 */

export const getServicesByShopId = async (shopId: string): Promise<Service[]> =>
  (await liveLesen<{ leistungen: Service[] }>(`live/laden/${encodeURIComponent(shopId)}/leistungen`)).leistungen;

/** Eine Leistung; null, wenn es sie nicht gibt */
export const getServiceByIdLegacy = async (serviceId: string): Promise<Service | null> => {
  try {
    return (await liveLesen<{ leistung: Service }>(`live/leistung/${encodeURIComponent(serviceId)}`)).leistung;
  } catch (error) {
    if (error instanceof LiveFehlt) return null;
    throw error;
  }
};

/** Wie getServiceByIdLegacy, aber nur, wenn die Leistung zu diesem Laden gehört */
export const getServiceById = async (shopId: string, serviceId: string): Promise<Service | null> => {
  try {
    const service = await getServiceByIdLegacy(serviceId);
    return service && service.shopId === shopId ? service : null;
  } catch (error) {
    console.error('Error getting service by shopId and serviceId:', error);
    return null;
  }
};

export const createService = async (data: Omit<Service, 'id' | 'createdAt' | 'updatedAt'>): Promise<Service> =>
  (await backendSenden<{ leistung: Service }>('team/leistungen', { leistung: data })).leistung;

export const updateService = async (serviceId: string, updates: Partial<Omit<Service, 'id' | 'shopId' | 'createdAt' | 'updatedAt'>>): Promise<Service> =>
  (await backendSenden<{ leistung: Service }>(`team/leistungen/${encodeURIComponent(serviceId)}`, { aenderung: updates })).leistung;

/**
 * Leistung löschen heißt: ausblenden. Termine verweisen mit serviceId auf die Leistung (Name, Dauer, Preis
 * in Tresen, Auswertung, Meine Termine) – würde das Dokument verschwinden, stünde dort nur noch "Leistung".
 * Ausgeblendete Leistungen bietet keine Auswahl mehr an; die Zuordnung bei Personen (staff.serviceIds) bleibt
 * stehen, damit beim Wiederherstellen alles wie vorher ist.
 */
export const isOffered = (service: Pick<Service, 'archived'>) => !service.archived;

/** Nur die Leistungen, die man buchen und zuordnen kann */
export const offeredServices = <T extends Pick<Service, 'archived'>>(services: T[]): T[] => services.filter(isOffered);

/** Ausblenden; den Zeitpunkt (archivedAt) setzt das Backend */
export const archiveService = async (serviceId: string): Promise<void> => {
  await updateService(serviceId, { archived: true });
};

export const restoreService = async (serviceId: string): Promise<void> => {
  await updateService(serviceId, { archived: false });
};

/** Wie viele kommende, nicht abgesagte Termine diese Leistung haben (für die Rückfrage beim Löschen) */
export const countUpcomingAppointmentsWithService = async (_shopId: string, serviceId: string): Promise<number> =>
  (await liveLesen<{ anzahl: number }>(`team/leistungen/${encodeURIComponent(serviceId)}/kommende`, true)).anzahl;
