import brain from 'brain';
import type { PlaceDetailsData, PlaceSearchData, ShopSetupStatusData, SuggestedService, WebsiteServicesData } from '../brain/data-contracts';
import { createService, createShop, createStaff, updateShop } from './firestore';
import { createStaffInvite } from './staff-invitation';
import type { BusinessHoursDay } from './firestore/types';
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
  /** Vorlage wurde vorausgewählt und seitdem nicht angefasst – darf die Webseite wieder abwählen */
  autoSelected?: boolean;
}

/** Was beim Anlegen schon geschrieben ist – nach einem Abbruch geht es dort weiter (kein zweiter Laden) */
export interface SetupProgress {
  shopId?: string;
  /** Leistungs-Key → angelegte ID */
  serviceIds: Record<string, string>;
  /** Personen-Keys, die schon angelegt sind */
  staffKeys: string[];
  invitations: { name: string; email: string; link: string }[];
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
  /** Frage nach der Branche beantwortet (auch mit "Etwas anderes") */
  industryConfirmed: boolean;
  /** Branche, zu der die Vorlagen in services gehören */
  templateIndustry: string | null;
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
  progress?: SetupProgress;
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
  industryConfirmed: false,
  templateIndustry: null,
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
  // Vorlagen bleiben zur Auswahl; nur die unberührt vorausgewählten wählt die Webseite wieder ab –
  // was man während des Lesens selbst angekreuzt hat, bleibt angekreuzt
  const rest = services
    .filter((s) => !(s.source === 'template' && websiteNames.has(s.name.toLowerCase())))
    .map((s) => (s.source === 'template' && s.autoSelected && fromWebsite.length ? { ...s, selected: false, autoSelected: false } : s));
  return [...services.filter((s) => s.source === 'website'), ...fromWebsite, ...rest.filter((s) => s.source !== 'website')];
};

/**
 * Vorlagen der Branche bereitlegen: selbst angekreuzte Vorlagen (auch einer früheren Branche) bleiben,
 * unberührte Vorlagen werden durch die der aktuellen Branche ersetzt.
 */
export const withTemplates = (services: DraftService[], industry: string): DraftService[] => {
  const kept = services.filter((s) => s.source !== 'template' || (s.selected && !s.autoSelected));
  const names = new Set(kept.map((s) => s.name.toLowerCase()));
  const hasOwn = kept.some((s) => s.source === 'website');
  const templates: DraftService[] = templatesFor(industry)
    .filter((t) => !names.has(t.name.toLowerCase()))
    .map((t) => {
      const selected = Boolean(t.common) && !hasOwn;
      return { key: newKey('t'), name: t.name, category: t.category, duration: t.duration, price: t.price, selected, autoSelected: selected, source: 'template' };
    });
  return [...kept, ...templates];
};

/** Alle Personen, die Termine annehmen: Inhaber zuerst */
export const peopleOf = (draft: ShopDraft): DraftPerson[] => [
  ...(draft.ownerWorks ? [{ key: OWNER_KEY, name: draft.ownerName, email: draft.email, isOwner: true }] : []),
  ...draft.team.filter((p) => p.name.trim()),
];

export const assignmentOf = (draft: ShopDraft, key: string): Assignment => draft.assignments[key] ?? { serviceKeys: [], days: [] };

const openDaysOf = (draft: ShopDraft) => normalizeHours(draft.hours).filter((h) => h.isOpen).map((h) => h.dayOfWeek);

/**
 * Was eine Person tatsächlich bekommt. Verteilung und Arbeitstage gelten nur, solange es mehrere Personen
 * (bzw. Leistungen) gibt – wer danach Leute entfernt, behält sonst unbemerkt eine alte Teilauswahl.
 */
export const effectiveAssignment = (draft: ShopDraft, key: string): { serviceKeys: string[]; days: number[] } => {
  const people = peopleOf(draft);
  const chosen = draft.services.filter((s) => s.selected && s.name.trim()).map((s) => s.key);
  const openDays = openDaysOf(draft);
  const own = assignmentOf(draft, key);
  const distribute = people.length > 1 && chosen.length > 1 && draft.everyoneDoesAll === false;
  const picked = own.serviceKeys.filter((k) => chosen.includes(k));
  const byDays = people.length > 1 && draft.sameHours === false;
  const days = own.days.filter((d) => openDays.includes(d));
  return {
    serviceKeys: distribute && picked.length ? picked : chosen,
    days: byDays && days.length ? days : openDays,
  };
};

/** Leistungen, die nach der Verteilung niemand macht (wären nicht buchbar) */
export const unassignedServices = (draft: ShopDraft): DraftService[] => {
  const keys = new Set(peopleOf(draft).flatMap((p) => effectiveAssignment(draft, p.key).serviceKeys));
  return draft.services.filter((s) => s.selected && s.name.trim() && !keys.has(s.key));
};

// --- Anlegen ----------------------------------------------------------------------------------------

export interface SetupResult {
  shop: { id: string; name: string };
  invitations: SetupProgress['invitations'];
}

export const emptyProgress = (): SetupProgress => ({ serviceIds: {}, staffKeys: [], invitations: [] });

/**
 * Schreibt Laden, Leistungen, Team (und Einladungen) – in dieser Reihenfolge, weil alles auf den Laden zeigt.
 * Nach jedem Schritt meldet onSaved den Stand; der landet im Entwurf. Scheitert etwas (Netz weg, Seite neu
 * geladen), macht der nächste Aufruf dort weiter, statt einen zweiten Laden anzulegen.
 */
export const createFromDraft = async (
  uid: string,
  draft: ShopDraft,
  onProgress: (text: string) => void,
  onSaved: (progress: SetupProgress) => void,
): Promise<SetupResult> => {
  const progress: SetupProgress = { ...emptyProgress(), ...draft.progress };
  const save = () => onSaved({ ...progress, serviceIds: { ...progress.serviceIds }, staffKeys: [...progress.staffKeys], invitations: [...progress.invitations] });
  const hours = normalizeHours(draft.hours);
  const address = [draft.street, [draft.postalCode, draft.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const shopData = {
    name: draft.name.trim(),
    street: draft.street.trim(),
    postalCode: draft.postalCode.trim(),
    city: draft.city.trim(),
    address,
    phone: draft.phone.trim(),
    email: draft.email.trim(),
    website: draft.website.trim() || undefined,
    industry: draft.industry || undefined,
    ownerName: draft.ownerName.trim() || undefined,
    businessHoursByDay: hours,
    coordinates: draft.coordinates ?? undefined,
    googlePlaceId: draft.googlePlaceId || undefined,
  };

  onProgress('Laden anlegen …');
  if (progress.shopId) {
    await updateShop(progress.shopId, shopData); // schon angelegt: nur auf den letzten Stand bringen
  } else {
    progress.shopId = (await createShop(uid, shopData)).id;
    save();
  }
  const shopId = progress.shopId;

  onProgress('Leistungen eintragen …');
  const chosen = draft.services.filter((s) => s.selected && s.name.trim());
  for (const s of chosen) {
    if (progress.serviceIds[s.key]) continue;
    const created = await createService({
      shopId,
      name: s.name.trim(),
      category: s.category || '',
      description: s.priceFrom ? `Preis ab ${s.price.toLocaleString('de-DE')} €, je nach Aufwand` : '',
      duration: s.duration,
      setupTime: 0,
      price: s.price,
    });
    progress.serviceIds[s.key] = created.id;
    save();
  }

  onProgress('Team eintragen …');
  for (const p of peopleOf(draft)) {
    if (progress.staffKeys.includes(p.key)) continue;
    const { serviceKeys, days } = effectiveAssignment(draft, p.key);
    const email = p.email.trim();
    const staff = await createStaff({
      shopId,
      userId: p.isOwner ? uid : '',
      name: p.name.trim(),
      email,
      phone: '',
      role: p.isOwner ? 'Inhaber' : 'Team',
      serviceIds: serviceKeys.map((k) => progress.serviceIds[k]).filter(Boolean),
      isActive: true,
      workingHours: workingHoursFromOpening(hours, days),
      status: 'available',
    });
    progress.staffKeys.push(p.key);
    save();
    if (!p.isOwner && email) {
      try {
        // Link vom Backend (am Eintrag, nur als Hash gespeichert); E-Mail verschickt erst der Inhaber
        const invitation = await createStaffInvite(staff.id);
        progress.invitations.push({ name: p.name.trim(), email, link: invitation.link });
      } catch (error) {
        // Ohne Link trotzdem aufführen: Die Fertig-Seite sagt dann, wo es ihn gibt
        console.error('Einladung fehlgeschlagen:', error);
        progress.invitations.push({ name: p.name.trim(), email, link: '' });
      }
    }
    save();
  }
  return { shop: { id: shopId, name: shopData.name }, invitations: progress.invitations };
};

