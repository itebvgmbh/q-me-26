/**
 * Utility functions for user-related operations
 */

/**
 * Generates initials from a user's name
 * @param name The user's name
 * @returns The initials (first letter of each part of the name)
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase();
}
