import { type FirebaseApp, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { config } from "./config";
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

// Export the firebase auth instance
export const firebaseAuth = getAuth(firebaseApp);
