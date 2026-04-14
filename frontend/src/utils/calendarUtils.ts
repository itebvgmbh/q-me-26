import { format } from 'date-fns';

// Standardstunden für den Zeitplan (9:00 - 17:00)
export const HOURS = Array.from({ length: 9 }, (_, i) => i + 9);

// Überprüft, ob ein Datum der aktuelle Tag ist
export const isCurrentDay = (date: Date): boolean => {
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
};

// Berechnet die Position für die aktuelle Zeitanzeige
export const getCurrentTimePosition = (): { top: string } => {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const top = (hours - 9) * 60 + minutes;
  return { top: `${top}px` };
};

// Berechnet Styling für einen Termin basierend auf Start- und Endzeit
export const getAppointmentStyle = (startTime: Date, endTime: Date): { top: string; height: string } => {
  const startHour = startTime.getHours();
  const startMinutes = startTime.getMinutes();
  const endHour = endTime.getHours();
  const endMinutes = endTime.getMinutes();

  // Exakte Berechnung relativ zum Start der Zeitleiste (9 Uhr)
  const topPosition = (startHour - 9) * 60 + startMinutes;
  
  // Berechnung der Slot-Höhe (1 Stunde = 60px)
  const slotHeight = (endHour - startHour) * 60 + (endMinutes - startMinutes);
  
  return {
    top: `${topPosition}px`,
    height: `${slotHeight}px`,
  };
};

// Berechnet passende Schriftgröße und Sichtbarkeit basierend auf der Slotdauer
export const getSlotDisplayProperties = (startTime: Date, endTime: Date): {
  fontSize: string;
  shouldShowText: boolean;
} => {
  const durationMinutes = (endTime.getTime() - startTime.getTime()) / (1000 * 60);
  
  let fontSize = 'text-xs';
  let shouldShowText = true;
  
  if (durationMinutes >= 30) {
    fontSize = 'text-sm';
  } else if (durationMinutes < 15) {
    shouldShowText = false;
  }

  return { fontSize, shouldShowText };
};

// Formatiert einen Zeitslot für die Anzeige
export const formatTimeSlot = (startTime: Date, endTime: Date): string => {
  return `${format(startTime, 'HH:mm')} - ${format(endTime, 'HH:mm')}`;
};
