import { Timestamp } from 'firebase/firestore';
import { merke, type Sprache } from '@/i18n';

export type UserRole = 'shopOwner' | 'employee' | 'customer';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  displayName?: string;
  phoneNumber?: string;
  /** Zuletzt gewählte Sprache – für E-Mails vom Backend an das Konto (backend/app/i18n) */
  language?: Sprache;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Deutsch als Schlüssel – angezeigt mit t(USER_ROLES[rolle]) */
export const USER_ROLES: { [key in UserRole]: string } = {
  shopOwner: merke('Inhaber eines Ladens'),
  employee: merke('Im Team eines Ladens'),
  customer: merke('Kunde')
};

export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

/** Deutsch als Schlüssel – angezeigt mit t(DAYS_OF_WEEK[tag]) */
export const DAYS_OF_WEEK: { [key in DayOfWeek]: string } = {
  monday: merke('Montag'),
  tuesday: merke('Dienstag'),
  wednesday: merke('Mittwoch'),
  thursday: merke('Donnerstag'),
  friday: merke('Freitag'),
  saturday: merke('Samstag'),
  sunday: merke('Sonntag')
};

export interface BusinessHours {
  day: DayOfWeek;
  open: boolean;
  openTime?: string;
  closeTime?: string;
  breakStart?: string;
  breakEnd?: string;
}

export interface Service {
  id: string;
  name: string;
  description?: string;
  duration: number; // in minutes
  price: number;
  category?: string;
}

export interface ShopProfile {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  address: {
    street: string;
    city: string;
    postalCode: string;
    country: string;
  };
  contact: {
    phone?: string;
    email?: string;
    website?: string;
  };
  businessHours: BusinessHours[];
  services: Service[];
  photos: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Appointment scheduling types
export interface TimeSlot {
  start: Date;
  end: Date;
  isAvailable: boolean;
}

export interface EarlierSlotNotificationType {
  id: string;
  appointmentId: string;
  userId: string;
  shopId: string;
  staffId: string;
  serviceId: string;
  originalStartTime: Date;
  originalEndTime: Date;
  earlierStartTime: Date;
  earlierEndTime: Date;
  createdAt: Date;
  isRead: boolean;
  isAccepted: boolean;
  /** 'offered' oder 'expired' (Frist abgelaufen, der Platz ging an die nächste Person) */
  status?: string;
  /** bis dann gehört das Angebot exklusiv diesem Kunden */
  expiresAt?: Date;
}

/**
 * Repräsentiert einen Kalender-Zeitslot mit Start- und Endzeit
 */
export interface CalendarTimeSlot {
  start: Date;
  end: Date;
  /** Bei „Egal wer“: wer zu dieser Zeit frei ist, in der Reihenfolge, in der gebucht wird */
  staffOptions?: string[];
}

/**
 * Repräsentiert einen Block im Kalender (Termin oder verfügbarer Slot)
 */
export interface AppointmentBlock {
  id: string;
  startTime: Date;
  endTime: Date;
  title: string;
  isAvailable: boolean;
  type: 'appointment' | 'availableSlot';
}

export interface AvailabilityRequest {
  shopId: string;
  serviceId: string;
  staffId?: string;
  date: string; // Format: YYYY-MM-DD
}

// API-Antwortformat für Zeitslots
export interface ApiTimeSlot {
  start_time: string; // ISO string
  end_time: string; // ISO string
  is_available: boolean;
}

export interface AvailabilityResponse {
  timeslots: ApiTimeSlot[];
}