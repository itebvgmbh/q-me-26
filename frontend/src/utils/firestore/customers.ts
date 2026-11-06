import { auth } from 'app';
import { Customer, CustomerVisit } from './types';
import { backendSenden, liveLesen } from '../live';
import { t } from '@/i18n';

/**
 * Neuer Link, mit dem eine angelegte Person ihr Konto verbindet (Seite /activate), z. B. https://dranzeit.de/activate?token=…
 * Erzeugt das Backend (backend/app/apis/customer_activation): Es speichert nur einen Hash des Tokens, den Link gibt es
 * nur in dieser Antwort. Der alte Link gilt danach nicht mehr. Wirft mit einer Meldung für den Laden.
 */
export const createActivationLink = async (customerId: string): Promise<{ link: string; expires: string }> => {
  let res: Response;
  try {
    const headers = { Authorization: await auth.getAuthHeaderValue(), 'Content-Type': 'application/json' };
    res = await fetch('/routes/customer-activation', { method: 'POST', headers, body: JSON.stringify({ customer_id: customerId }) });
  } catch {
    throw new Error(t('Keine Verbindung zum Server. Bitte prüf dein Internet.'));
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body?.detail === 'string' && body.detail ? body.detail : t('Das hat nicht geklappt (Fehler {status}).', { status: res.status }));
  return body;
};

/**
 * customerId für einen Termin dieser Person. Hat sie ihr Konto verbunden, gehört der Termin dem Konto –
 * dann steht er unter "Meine Termine", und "Früher dran" kann sie erreichen. Sonst die ID des Eintrags.
 */
export const appointmentCustomerId = (customer: Customer) => customer.userId || customer.id;

/**
 * Nach dem Buchen mit Konto (Nummer ziehen, Termin buchen): eigenen Kunden-Eintrag im Laden gleich verbunden anlegen,
 * oder einen vorhandenen mit derselben bestätigten E-Mail verbinden. Das macht das Backend
 * (backend/app/apis/customer_activation), damit niemand über eine fremde Adresse einen Eintrag übernimmt.
 * Wirft nie: Die Buchung zählt, der Eintrag ist Beiwerk.
 */
export const linkOwnCustomerEntry = async (shopId: string): Promise<void> => {
  try {
    const headers = { Authorization: await auth.getAuthHeaderValue() };
    const res = await fetch(`/routes/customer-link/${encodeURIComponent(shopId)}`, { method: 'POST', headers });
    if (!res.ok) console.error('Kunden-Eintrag nicht verbunden, Status', res.status);
  } catch (error) {
    console.error('Kunden-Eintrag nicht verbunden:', error);
  }
};

// Filter customers to ensure unique entries by ID and email
export const getUniqueCustomers = (customers: Customer[]): Customer[] => {
  // First, create a map to deduplicate by ID
  const idMap = new Map<string, Customer>();
  const emailMap = new Map<string, Customer>();
  const result: Customer[] = [];
  
  // First pass: Deduplicate by ID
  customers.forEach(customer => {
    if (!idMap.has(customer.id)) {
      idMap.set(customer.id, customer);
    }
  });
  
  // Convert to array of unique ID customers
  const uniqueByIdCustomers = Array.from(idMap.values());
  
  // Second pass: Deduplicate by email if it exists
  uniqueByIdCustomers.forEach(customer => {
    if (customer.email) {
      if (!emailMap.has(customer.email)) {
        emailMap.set(customer.email, customer);
        result.push(customer);
      }
    } else {
      // If no email, just add to result
      result.push(customer);
    }
  });
  
  console.log('Original customers count:', customers.length);
  console.log('Unique customers count:', result.length);
  
  return result;
};

/**
 * Kundenliste über das Backend (requirements/eigene-datenbank.md, Stufe 2; backend/app/libs/laeden.py): lesen und
 * anlegen Inhaber und Team. Neue Einträge sind nie mit einem Konto verbunden; das macht der Kunden-Link.
 */
const kundenDesLadens = async (shopId: string): Promise<Customer[]> =>
  (await liveLesen<{ kunden: Customer[] }>(`team/laeden/${encodeURIComponent(shopId)}/kunden`, true)).kunden;

export const getCustomersByShopId = async (shopId: string): Promise<Customer[]> => {
  try {
    return getUniqueCustomers(await kundenDesLadens(shopId));
  } catch (error) {
    console.error('Error getting customers:', error);
    return [];
  }
};

/** Termine eines Eintrags in diesem Laden, neueste zuerst – auch die mit dem verbundenen Konto gebuchten */
export const getCustomerVisits = async (shopId: string, customerId: string): Promise<CustomerVisit[]> =>
  (await liveLesen<{ termine: CustomerVisit[] }>(
    `team/laeden/${encodeURIComponent(shopId)}/kunden/${encodeURIComponent(customerId)}/termine`,
    true,
  )).termine;

/** Alle Einträge eines Ladens, auch doppelte – für die Kundenliste, aus der man löschen kann */
export const getCustomerEntries = async (shopId: string): Promise<Customer[]> =>
  (await kundenDesLadens(shopId)).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));

/** Kunde mit dieser E-Mail in diesem Laden, sonst null */
export const findCustomerByEmailAndShop = async (email: string, shopId: string): Promise<Customer | null> => {
  if (!email || !shopId) return null;
  try {
    return (await kundenDesLadens(shopId)).find((c) => c.email === email) ?? null;
  } catch (error) {
    console.error('Error finding customer:', error);
    return null;
  }
};

/** Neuer Kunde; gibt es die E-Mail im Laden schon, kommt der vorhandene Eintrag zurück (prüft das Backend) */
export const createCustomer = async (
  data: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'activationTokenHash' | 'activationExpires' | 'isActive'>,
): Promise<Customer> => (await backendSenden<{ kunde: Customer }>('team/kunden', { kunde: data })).kunde;
