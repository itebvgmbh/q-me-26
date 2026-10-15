import { APP_BASE_PATH } from 'app';
import brain from 'brain';
import type { PlaceDetailsData, PlaceSearchData, ShopSetupStatusData, SuggestedService, WebsiteServicesData } from '../brain/data-contracts';
import { createService, createShop, createStaff, createStaffInvitation } from './firestore';
import type { BusinessHoursDay, Shop } from './firestore/types';
import { defaultHours, normalizeHours, workingHoursFromOpening } from './opening-hours';
import { templatesFor } from './service-templates';

/**
 * Laden einrichten: Entwurf, den der Assistent Frage für Frage füllt, und das Anlegen am Ende.
 * Geschrieben wird erst ganz zum Schluss; bis dahin liegt der Entwurf nur im Browser.
 */

export interface DraftService {
  key: string;
  name: string;
  category: string;
  duration: number;
  price: number;
  priceFrom?: boolean;
  selected: boolean;
  source: 'website' | 'template' | 'own';
  durationGuessed?: boolean;
}

export interface DraftPerson {
  key: string;
  name: string;
  email: string;
  /** Inhaber selbst – bekommt das eigene Konto verknüpft */
  isOwner?: boolean;
}

/** Wer was macht und wann arbeitet, je Person (key 'owner' für den Inhaber) */
export interface Assignment {
  /** Leistungs-Keys; leer = alle */
  serviceKeys: string[];
  /** Arbeitstage (dayOfWeek); leer = alle offenen Tage */
  days: number[];
}

export const OWNER_KEY = 'owner';

export interface ShopDraft {
  step: string;
  source: 'google' | 'manual' | null;
  googlePlaceId: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  coordinates: { latitude: number; longitude: number } | null;
  industry: string;
  /** Branche kam von Google und wurde noch nicht bestätigt */
  industryGuessed: boolean;
  hours: BusinessHoursDay[];
  hoursFromGoogle: boolean;
  services: DraftService[];
  /** Webseite wurde schon ausgelesen (nicht noch einmal automatisch) */
  websiteRead: string;
  ownerWorks: boolean | null;
  /** So sehen Kunden den Inhaber, wenn er selbst Termine annimmt */
  ownerName: string;
  team: DraftPerson[];
  assignments: Record<string, Assignment>;
  everyoneDoesAll: boolean | null;
  sameHours: boolean | null;
}

export const emptyDraft = (email = '', ownerName = ''): ShopDraft => ({
  step: 'find',
  source: null,
  googlePlaceId: '',
  name: '',
  street: '',
  postalCode: '',
  city: '',
  phone: '',
  email,
  website: '',
  coordinates: null,
  industry: '',
  industryGuessed: false,
  hours: defaultHours(),
  hoursFromGoogle: false,
  services: [],
  websiteRead: '',
  ownerWorks: null,
  ownerName,
  team: [],
  assignments: {},
  everyoneDoesAll: null,
  sameHours: null,
});

let counter = 0;
export const newKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

// --- Zwischenspeichern (nur Komfort: Neuladen setzt fort; ohne Speicher geht es auch) ----------------

const storageKey = (uid: string) => `qme-laden-einrichten-${uid}`;

export const loadDraft = (uid: string): ShopDraft | null => {
  try {
    const raw = window.localStorage.getItem(storageKey(uid));
    return raw ? { ...emptyDraft(), ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
};

export const saveDraft = (uid: string, draft: ShopDraft) => {
  try {
    window.localStorage.setItem(storageKey(uid), JSON.stringify(draft));
  } catch {
    /* privater Modus o. ä. – dann eben ohne Fortsetzen */
  }
};

export const clearDraft = (uid: string) => {
  try {
    window.localStorage.removeItem(storageKey(uid));
  } catch {
    /* egal */
  }
};

// --- Backend ---------------------------------------------------------------------------------------

/** Antwort lesen; bei Fehlern die Meldung des Backends als Error */
const call = async <T>(request: Promise<Response>): Promise<T> => {
  try {
    const response = await request;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Response) {
      let detail = '';
      try {
        detail = (await error.json())?.detail;
      } catch {
        /* keine JSON-Antwort */
      }
      throw new Error(typeof detail === 'string' && detail ? detail : `Das hat nicht geklappt (Fehler ${error.status}).`);
    }
    throw new Error('Keine Verbindung zum Server. Bitte prüf dein Internet.');
  }
};

export const setupStatus = (): Promise<ShopSetupStatusData> =>
  call<ShopSetupStatusData>(brain.shop_setup_status()).catch(() => ({ google: false, ai: false }));

export const searchPlaces = (query: string, sessionToken: string, signal?: AbortSignal) =>
  call<PlaceSearchData>(brain.shop_setup_places_search({ query, session_token: sessionToken }, { signal }));

export const placeDetails = (placeId: string, sessionToken: string) =>
  call<PlaceDetailsData>(brain.shop_setup_place_details({ place_id: placeId, session_token: sessionToken }));

export const websiteServices = (url: string, industry?: string) =>
  call<WebsiteServicesData>(brain.shop_setup_website_services({ url, industry: industry || null }));

/** Google-Entwurf in den eigenen Entwurf übernehmen (eigene Eingaben wie E-Mail bleiben) */
export const applyPlace = (draft: ShopDraft, place: PlaceDetailsData): ShopDraft => {
  const hours = place.businessHoursByDay?.length ? normalizeHours(place.businessHoursByDay) : draft.hours;
  return {
    ...draft,
    source: 'google',
    googlePlaceId: place.googlePlaceId,
    name: place.name || draft.name,
    street: place.street,
    postalCode: place.postalCode,
    city: place.city,
    phone: place.phone,
    website: place.website,
    coordinates: place.coordinates,
    industry: place.industry || draft.industry,
    industryGuessed: Boolean(place.industry),
    hours,
    hoursFromGoogle: Boolean(place.businessHoursByDay?.length),
    websiteRead: '',
  };
};

/** Leistungen von der Webseite vor die Vorlagen setzen; gleiche Namen nicht doppelt */
export const mergeWebsiteServices = (services: DraftService[], found: SuggestedService[]): DraftService[] => {
  const taken = new Set(services.filter((s) => s.source !== 'template').map((s) => s.name.toLowerCase()));
  const fromWebsite: DraftService[] = found
    .filter((s) => !taken.has(s.name.toLowerCase()))
    .map((s) => ({ key: newKey('w'), name: s.name, category: s.category, duration: s.duration, price: s.price, priceFrom: s.priceFrom, durationGuessed: s.durationGuessed, selected: true, source: 'website' }));
  const websiteNames = new Set(fromWebsite.map((s) => s.name.toLowerCase()));
  // Vorlagen bleiben zur Auswahl, sind aber nicht mehr vorausgewählt, wenn die Webseite etwas geliefert hat
  const rest = services
    .filter((s) => !(s.source === 'template' && websiteNames.has(s.name.toLowerCase())))
    .map((s) => (s.source === 'template' && fromWebsite.length ? { ...s, selected: false } : s));
  return [...services.filter((s) => s.source === 'website'), ...fromWebsite, ...rest.filter((s) => s.source !== 'website')];
};

/** Vorlagen der Branche ergänzen (bestehende Auswahl bleibt) */
export const withTemplates = (services: DraftService[], industry: string): DraftService[] => {
  const kept = services.filter((s) => s.source !== 'template' || s.selected);
  const names = new Set(kept.map((s) => s.name.toLowerCase()));
  const hasOwn = kept.some((s) => s.source === 'website');
  const templates: DraftService[] = templatesFor(industry)
    .filter((t) => !names.has(t.name.toLowerCase()))
    .map((t) => ({ key: newKey('t'), name: t.name, category: t.category, duration: t.duration, price: t.price, selected: Boolean(t.common) && !hasOwn, source: 'template' }));
  return [...kept, ...templates];
};

/** Alle Personen, die Termine annehmen: Inhaber zuerst */
export const peopleOf = (draft: ShopDraft): DraftPerson[] => [
  ...(draft.ownerWorks ? [{ key: OWNER_KEY, name: draft.ownerName, email: draft.email, isOwner: true }] : []),
  ...draft.team.filter((p) => p.name.trim()),
];

export const assignmentOf = (draft: ShopDraft, key: string): Assignment => draft.assignments[key] ?? { serviceKeys: [], days: [] };

// --- Anlegen ----------------------------------------------------------------------------------------

export interface SetupResult {
  shop: Shop;
  invitations: { name: string; email: string; link: string }[];
}

/** Schreibt Laden, Leistungen, Team (und Einladungen) – in dieser Reihenfolge, weil alles auf den Laden zeigt */
export const createFromDraft = async (
  uid: string,
  draft: ShopDraft,
  onProgress: (text: string) => void,
  onShopCreated?: (shop: Shop) => void,
): Promise<SetupResult> => {
  const ownerName = draft.ownerName;
  const hours = normalizeHours(draft.hours);
  onProgress('Laden anlegen …');
  const address = [draft.street, [draft.postalCode, draft.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const shop = await createShop(uid, {
    name: draft.name.trim(),
    street: draft.street.trim(),
    postalCode: draft.postalCode.trim(),
    city: draft.city.trim(),
    address,
    phone: draft.phone.trim(),
    email: draft.email.trim(),
    website: draft.website.trim() || undefined,
    industry: draft.industry || undefined,
    ownerName: ownerName.trim() || undefined,
    businessHoursByDay: hours,
    coordinates: draft.coordinates ?? undefined,
    googlePlaceId: draft.googlePlaceId || undefined,
  });
  onShopCreated?.(shop);

  onProgress('Leistungen eintragen …');
  const chosen = draft.services.filter((s) => s.selected && s.name.trim());
  const created = await Promise.all(
    chosen.map((s) =>
      createService({
        shopId: shop.id,
        name: s.name.trim(),
        category: s.category || '',
        description: s.priceFrom ? `Preis ab ${s.price.toLocaleString('de-DE')} €, je nach Aufwand` : '',
        duration: s.duration,
        setupTime: 0,
        price: s.price,
      }),
    ),
  );
  const idOf = new Map(chosen.map((s, i) => [s.key, created[i].id]));

  onProgress('Team eintragen …');
  const people = peopleOf(draft);
  const invitations: SetupResult['invitations'] = [];
  for (const p of people) {
    const { serviceKeys, days } = assignmentOf(draft, p.key);
    const picked = serviceKeys.map((k) => idOf.get(k)).filter((id): id is string => Boolean(id));
    const serviceIds = draft.everyoneDoesAll === false && picked.length ? picked : created.map((s) => s.id);
    const email = p.email.trim();
    await createStaff({
      shopId: shop.id,
      userId: p.isOwner ? uid : '',
      name: p.name.trim(),
      email,
      phone: '',
      role: p.isOwner ? 'Inhaber' : 'Team',
      serviceIds,
      isActive: true,
      workingHours: workingHoursFromOpening(hours, draft.sameHours === false && days.length ? days : undefined),
      status: 'available',
    });
    if (!p.isOwner && email) {
      try {
        const invitation = await createStaffInvitation(shop.id, email, false);
        invitations.push({ name: p.name.trim(), email, link: `${window.location.origin}${APP_BASE_PATH}/staff-registration?token=${invitation.token}` });
      } catch (error) {
        console.error('Einladung fehlgeschlagen:', error);
      }
    }
  }
  return { shop, invitations };
};
