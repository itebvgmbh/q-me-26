import { type FirebaseApp, initializeApp } from "firebase/app";
import { browserLocalPersistence, browserSessionPersistence, indexedDBLocalPersistence, initializeAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { simpleConnectionWanted } from "../../utils/connection";

// Export the firebase app instance in case it's needed by other modules.
export const firebaseApp: FirebaseApp = initializeApp({
  apiKey: "AIzaSyCpgbiFJD9_s3RidrNVGUoVEvgcE8cE4DE",
  authDomain: "qmedata-7c79e.firebaseapp.com",
  projectId: "qmedata-7c79e",
  storageBucket: "qmedata-7c79e.firebasestorage.app",
  messagingSenderId: "189966000888",
  appId: "1:189966000888:web:73a249b8bacb35df2fd10d"
});
// Firestore einmal zentral einrichten, bevor irgendwo getFirestore() läuft: Felder mit
// "undefined" (z. B. customerId bei anonymen Nummern) werden ausgelassen, statt den ganzen
// Speichervorgang abzulehnen ("Unsupported field value: undefined").
// Nach einem Verbindungsfehler (manche WLANs) einfache Verbindungsart, siehe utils/connection.ts.
initializeFirestore(firebaseApp, {
  ignoreUndefinedProperties: true,
  ...(simpleConnectionWanted() ? { experimentalForceLongPolling: true } : {}),
});

// Wie getAuth(), aber ohne Anmeldung per Popup/Weiterleitung (Google & Co. bieten wir nicht an): Der Code dafür
// fehlt so in jedem Seitenaufruf. Speicherorte und Reihenfolge wie bei getAuth(), damit Angemeldete angemeldet bleiben.
export const firebaseAuth = initializeAuth(firebaseApp, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
});
