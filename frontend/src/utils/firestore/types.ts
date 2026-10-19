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
  timeSlotBuffer?: number; // Puffer in Millisekunden für die Zeitslot-Suche (Standard: 60000 = 1 Minute)  
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
  };
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
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface StaffInvitation {
  id: string;
  shopId: string;
  email: string;
  token: string;
  status: 'pending' | 'used';
  expiresAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  emailSent?: boolean;
  emailSentAt?: Timestamp;
}

export interface Staff {
  id: string;
  shopId: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  serviceIds: string[];
  isActive: boolean;
  workingHours: WorkingHours[];
  status: 'available' | 'busy' | 'break' | 'off';
  currentCustomer?: string;
  profileImageUrl?: string;
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
  activationToken?: string;
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
  referenceCode?: string;
  /** Aufgerufen am Tresen (Status "in-progress"), für die Auswertung */
  calledAt?: Timestamp;
  /** Fertig (Status "completed") */
  completedAt?: Timestamp;
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