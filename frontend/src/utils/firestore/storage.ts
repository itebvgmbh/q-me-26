import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase-client';

/**
 * Lädt ein Bild hoch und gibt die Download-URL zurück
 * @param file Das hochzuladende Bild (File-Objekt)
 * @param path Der Pfad im Firebase Storage (ohne führenden oder abschließenden /)
 * @returns Die URL zum hochgeladenen Bild
 */
export const uploadImage = async (file: File, path: string): Promise<string> => {
  // Eindeutigen Dateinamen erstellen
  const timestamp = new Date().getTime();
  const fileName = `${timestamp}_${file.name}`;

  // Vollständigen Pfad erstellen
  const fullPath = `${path}/${fileName}`;

  // Referenz zum Storage erstellen
  const storageRef = ref(storage, fullPath);

  // Bild hochladen
  const snapshot = await uploadBytes(storageRef, file);

  // URL zum hochgeladenen Bild abrufen und zurückgeben
  return await getDownloadURL(snapshot.ref);
};
