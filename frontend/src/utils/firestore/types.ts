import { Timestamp } from 'firebase/firestore';

export interface BusinessHoursDay {
  dayOfWeek: number; // 0-6, where 0 is Sunday, 1 is Monday, etc.
  isOpen: boolean;
  openTime: string; // Format: "HH:mm"
  closeTime: string; // Format: "HH:mm"
  /** Zeiten, in denen der Laden zwischendurch zu hat (z. B. Mittag); gelten für alle Personen */
  breaks?: { startTime: string; endTime: string }[];
}

export interface Shop {
  id: string;
  name: string;
  address?: string; // Legacy field, kept for backward compatibility
  street?: string;
  city?: string;
  postalCode?: string;
  phone: string;
  email: string;
  description?: string;
  ownerName?: string; // Name des Inhabers
  businessHours?: string; // Legacy format, kept for backward compatibility
  businessHoursByDay?: BusinessHoursDay[]; // New format with day-specific hours
  industry?: string; // ID der Branche (barbershop, physiotherapy, etc.)
  logoUrl?: string; // URL des Shop-Logos
  website?: string;
  /** Google-Eintrag, aus dem der Laden übernommen wurde */
  googlePlaceId?: string;
  owner: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  }; // Gespeicherte Koordinaten für Kartenansicht
  /** Vorlaufzeit für Online-Termine in Millisekunden (utils/booking-rules.ts onlineLeadMinutes); ältere Läden: Text */
  timeSlotBuffer?: number;  
  /** Tarif (utils/plans.ts); das bezahlte Abo steht in billing und wird nur vom Backend geschrieben */
  plan?: 'gratis' | 'solo' | 'laden' | 'team';
  trialEndsAt?: Timestamp;
  founder?: boolean;
  billing?: {
    plan?: 'gratis' | 'solo' | 'laden' | 'team';
    status?: string;
    interval?: 'monat' | 'jahr';
    currentPeriodEnd?: Timestamp;
    cancelAtPeriodEnd?: boolean;
    /** Stripe-Kunde; gibt es, sobald einmal ein Abo begonnen wurde (dann auch Rechnungen) */
    customerId?: string;
  };
  /** Tarif vom Betreiber ohne Stripe freigeschaltet (utils/plans.ts activeGrant); schreibt nur das Backend */
  grant?: { plan?: 'solo' | 'laden' | 'team'; until?: Timestamp } | null;
  /** Vom Betreiber gesperrt (utils/plans.ts isSuspended): nicht buchbar, nicht auffindbar */
  suspended?: { at?: Timestamp } | null;
  /** Merker der Startklar-Liste am Tresen (components/onboarding/Startklar.tsx) */
  onboarding?: { testlaufAt?: Timestamp; plakatAt?: Timestamp; dismissedAt?: Timestamp };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface WorkingHours {
  dayOfWeek: number; // 0-6, where 0 is Sunday
  startTime: string; // Format: "HH:mm"
  endTime: string; // Format: "HH:mm"
  isWorking: boolean;
}

export interface Service {
  id: string;
  shopId: string;
  name: string;
  description?: string;
  duration: number; // in minutes
  setupTime?: number; // in minutes - Rüstzeit
  price: number;
  category?: string;
  /** Gelöscht: nicht mehr buchbar, bleibt aber für bestehende Termine erhalten (utils/firestore/services.ts) */
  archived?: boolean;
  archivedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Staff {
  id: string;
  shopId: string;
  userId: string;
  name: string;
  /** E-Mail, Telefon und Einladungsadresse stehen nicht am Eintrag, sondern bei den Kontakten des Ladens, die nur der
   *  Inhaber liest (utils/firestore/staff-contacts.ts); hier nur, wenn sie für den Inhaber dazugeladen wurden */
  email: string;
  phone: string;
  role: string;
  serviceIds: string[];
  isActive: boolean;
  workingHours: WorkingHours[];
  status: 'available' | 'busy' | 'break' | 'off';
  currentCustomer?: string;
  profileImageUrl?: string;
  // Einladung (setzt nur das Backend, app/apis/staff_invitation): Hash des Tokens, nie das Token selbst
  inviteTokenHash?: string;
  inviteCreatedAt?: Timestamp;
  inviteExpires?: Timestamp;
  inviteEmailSentAt?: Timestamp;
  inviteEmailTo?: string;
  inviteAcceptedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Customer {
  id: string;
  shopId: string;
  name: string;
  email: string;
  phone?: string;
  userId?: string;
  /** SHA-256 des Tokens im Kunden-Link /activate – das Token selbst kennt nur, wer den Link bekommen hat */
  activationTokenHash?: string;
  activationExpires?: Timestamp;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Appointment {
  id: string;
  shopId: string;
  customerId?: string;
  customerName?: string;
  /** Telefonnummer bei Buchung ohne Konto */
  customerPhone?: string;
  serviceId: string;
  staffId?: string;
  type?: 'queue' | 'booked';
  status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
  startTime: Timestamp;
  endTime: Timestamp;
  price?: number;
  checkEarlierOptions?: boolean;
  checkEarlierOptionsCreatedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isAnonymous?: boolean;
  /** Nummer ohne Konto: SHA-256 des Schlüssels im Link der Nummernseite (utils/ticket-key.ts) – absagen, übernehmen */
  ticketKeyHash?: string;
  referenceCode?: string;
  /** Aufgerufen am Tresen (Status "in-progress"), für die Auswertung – nur der erste Aufruf */
  calledAt?: Timestamp;
  /** Letzter Aufruf (auch nach "zurück auf Wartet"), für die Prognose der Schlange */
  lastCalledAt?: Timestamp;
  /** Fertig (Status "completed") */
  completedAt?: Timestamp;
  /** "Du bist dran" ist raus (setzt der Benachrichtigungsdienst) */
  notifiedCalledAt?: Timestamp | null;
  /** Nicht gekommen (vom Tresen abgesagt) */
  noShow?: boolean;
  /** Offene Nachricht an den Kunden: Laden hat abgesagt oder verschoben (schickt der Benachrichtigungsdienst) */
  customerNotice?: 'cancelled' | 'moved' | null;
  customerNoticePreviousStart?: Timestamp | null;
  customerNoticeAt?: Timestamp;
}

export interface QueueEntry {
  id: string;
  shopId: string;
  customerId: string;
  customerName: string;
  joinedAt: Timestamp;
  status: 'waiting' | 'served' | 'cancelled';
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}