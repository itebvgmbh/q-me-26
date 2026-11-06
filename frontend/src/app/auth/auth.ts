import { anmeldung, signOut as abmelden, sendPasswordResetEmail as passwortMail, type User } from "./konto";

/**
 * Hilfen rund um das eigene Konto (app/auth/konto.ts). Die Anmeldung reist im Cookie mit, ein Token gibt es nicht:
 * getAuthToken() liefert "" und getAuthHeaderValue() einen leeren Kopf, damit ältere Aufrufer unverändert bleiben.
 */

const signOut = async (): Promise<void> => abmelden(anmeldung);

const getCurrentUser = (): User | null => anmeldung.currentUser;

const sendPasswordResetEmail = async (email: string) => passwortMail(anmeldung, email);

const getAuthToken = async (): Promise<string | null> => (anmeldung.currentUser ? "" : null);

const getAuthHeaderValue = async (): Promise<string> => "";

export const auth = {
  getAuthHeaderValue,
  getAuthToken,
  getCurrentUser,
  sendPasswordResetEmail,
  signOut,
};
