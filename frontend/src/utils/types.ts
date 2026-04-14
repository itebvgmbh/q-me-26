import { Timestamp } from 'firebase/firestore';

export type UserRole = 'shopOwner' | 'employee' | 'customer';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  displayName?: string;
  phoneNumber?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const USER_ROLES: { [key in UserRole]: string } = {
  shopOwner: 'Shop-Betreiber',
  employee: 'Mitarbeiter',
  customer: 'Kunde'
};

export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export const DAYS_OF_WEEK: { [key in DayOfWeek]: string } = {
  monday: 'Montag',
  tuesday: 'Dienstag',
  wednesday: 'Mittwoch',
  thursday: 'Donnerstag',
  friday: 'Freitag',
  saturday: 'Samstag',
  sunday: 'Sonntag'
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
}

/**
 * Repräsentiert einen Kalender-Zeitslot mit Start- und Endzeit
 */
export interface CalendarTimeSlot {
  start: Date;
  end: Date;
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