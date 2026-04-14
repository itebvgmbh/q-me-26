/**
 * Utility functions for working with appointments in the calendar
 */

/**
 * Returns a CSS class for styling an appointment based on its status
 * 
 * @param status - The appointment status
 * @returns CSS class for the appointment's status
 */
export const getStatusColor = (status: string): string => {
  switch (status) {
    case 'scheduled':
      return 'bg-blue-100 hover:bg-blue-200';
    case 'in-progress':
      return 'bg-yellow-100 hover:bg-yellow-200';
    case 'completed':
      return 'bg-green-100 hover:bg-green-200';
    case 'cancelled':
      return 'bg-red-100 hover:bg-red-200';
    default:
      return 'bg-gray-100 hover:bg-gray-200';
  }
};

/**
 * Returns a human-readable label for an appointment status
 * 
 * @param status - The appointment status
 * @returns Formatted status label in German
 */
export const getStatusLabel = (status: string): string => {
  switch (status) {
    case 'scheduled':
      return 'Geplant';
    case 'in-progress':
      return 'In Bearbeitung';
    case 'completed':
      return 'Abgeschlossen';
    case 'cancelled':
      return 'Storniert';
    default:
      return 'Unbekannt';
  }
};

/**
 * Returns a human-readable label for a break type
 * 
 * @param type - The break type
 * @returns Formatted break type label in German
 */
export const getBreakTypeLabel = (type?: string): string => {
  switch (type) {
    case 'lunch': return 'Mittagspause';
    case 'coffee': return 'Kaffeepause';
    case 'personal': return 'Persönliche Pause';
    case 'other': return 'Sonstige Pause';
    default: return 'Pause';
  }
};
