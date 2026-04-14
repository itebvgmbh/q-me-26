import { getStorage } from 'firebase/storage';
import { firebaseApp } from '../../app/auth/firebase';

console.log("FIREBASE APP IS:", firebaseApp);
if (!firebaseApp) {
  console.error("FIREBASE APP IS UNDEFINED! Circular dependency or init error!");
}

// Initialize Firebase storage explicitly with the bucket URL string to bypass any missing metadata config issues
export let storage: ReturnType<typeof getStorage> | null = null;
try {
  storage = getStorage(firebaseApp, "gs://qmedata-7c79e.firebasestorage.app");
} catch (error) {
  console.warn("Storage initialization failed (safe to ignore if not uploading files):", error);
}
