import { type FirebaseApp, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { config } from "./config";

// Export the firebase app instance in case it's needed by other modules.
export const firebaseApp: FirebaseApp = initializeApp({
  apiKey: "AIzaSyCpgbiFJD9_s3RidrNVGUoVEvgcE8cE4DE",
  authDomain: "qmedata-7c79e.firebaseapp.com",
  projectId: "qmedata-7c79e",
  storageBucket: "qmedata-7c79e.firebasestorage.app",
  messagingSenderId: "189966000888",
  appId: "1:189966000888:web:73a249b8bacb35df2fd10d"
});
// Export the firebase auth instance
export const firebaseAuth = getAuth(firebaseApp);
