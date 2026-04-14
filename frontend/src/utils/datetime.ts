import { Timestamp } from 'firebase/firestore';

/**
 * Checks if a given time slot is available (not in the past)
 * @param startTime - The start time of the slot (can be Date, Timestamp or ISO string)
 * @param endTime - The end time of the slot (can be Date, Timestamp or ISO string)
 * @returns boolean - Whether the slot is available
 */
export const isTimeSlotAvailable = (startTime: any, endTime: any) => {
  try {
    // Use the safer date conversion utility
    const startDate = safelyConvertToDate(startTime);
    const endDate = safelyConvertToDate(endTime);
    
    // Slot is in the past
    if (endDate < new Date()) {
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error checking if time slot is available:', error, { startTime, endTime });
    return false; // Default to unavailable if there's an error
  }
};

/**
 * Safely converts a date value to a JavaScript Date object
 * @param dateValue - The date value to convert (can be Date, Timestamp or string)
 * @returns A JavaScript Date object
 */
export const safelyConvertToDate = (dateValue: any): Date => {
  if (!dateValue) return new Date(); // Default to current date
  
  // If it's already a Date, return it
  if (dateValue instanceof Date) return dateValue;
  
  // If it's a Firestore Timestamp, convert it
  if (dateValue && typeof dateValue.toDate === 'function') {
    return dateValue.toDate();
  }
  
  // Otherwise, try to parse it as a Date
  return new Date(dateValue);
};