/**
 * Utility functions for staff management
 */
import { merke, t } from '@/i18n';

const DAY_NAMES = [merke('Sonntag'), merke('Montag'), merke('Dienstag'), merke('Mittwoch'), merke('Donnerstag'), merke('Freitag'), merke('Samstag')];

/**
 * Returns the name of the day for a given day of week number
 * @param dayOfWeek - 0-6, where 0 is Sunday
 * @returns The day name in the current language (only for display)
 */
export const getDayName = (dayOfWeek: number): string => t(DAY_NAMES[dayOfWeek]);

/**
 * Default working hours for new staff members
 */
export const defaultWorkingHours = [
  { dayOfWeek: 0, startTime: '09:00', endTime: '17:00', isWorking: false }, // Sunday
  { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isWorking: true }, // Monday
  { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', isWorking: true }, // Tuesday
  { dayOfWeek: 3, startTime: '09:00', endTime: '17:00', isWorking: true }, // Wednesday
  { dayOfWeek: 4, startTime: '09:00', endTime: '17:00', isWorking: true }, // Thursday
  { dayOfWeek: 5, startTime: '09:00', endTime: '17:00', isWorking: true }, // Friday
  { dayOfWeek: 6, startTime: '09:00', endTime: '17:00', isWorking: false }, // Saturday
];
