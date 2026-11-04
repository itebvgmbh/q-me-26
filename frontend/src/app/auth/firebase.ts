import { type FirebaseApp, initializeApp } from "firebase/app";
import { browserLocalPersistence, browserSessionPersistence, indexedDBLocalPersistence, initializeAuth } from "firebase/auth";

// Nur noch für die Anmeldung (Firebase Auth) und Push (Firebase Messaging). Daten liest und schreibt der Browser
// seit Stufe 2 nur über das Backend (requirements/eigene-datenbank.md, utils/live.ts) – Firestore lädt hier nicht mehr.
export const firebaseApp: FirebaseApp = initializeApp({
  apiKey: "AIzaSyCpgbiFJD9_s3RidrNVGUoVEvgcE8cE4DE",
  authDomain: "qmedata-7c79e.firebaseapp.com",
  projectId: "qmedata-7c79e",
  storageBucket: "qmedata-7c79e.firebasestorage.app",
  messagingSenderId: "189966000888",
  appId: "1:189966000888:web:73a249b8bacb35df2fd10d"
});
// Wie getAuth(), aber ohne Anmeldung per Popup/Weiterleitung (Google & Co. bieten wir nicht an): Der Code dafür
// fehlt so in jedem Seitenaufruf. Speicherorte und Reihenfolge wie bei getAuth(), damit Angemeldete angemeldet bleiben.
export const firebaseAuth = initializeAuth(firebaseApp, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
});
