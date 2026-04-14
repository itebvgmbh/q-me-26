// Firebase client configuration
import { getStorage } from 'firebase/storage';
import { firebaseApp } from '../app/auth/firebase';

// Initialize Firebase storage explicitly with the bucket URL string
export let storage: ReturnType<typeof getStorage> | null = null;
try {
  storage = getStorage(firebaseApp, "gs://qmedata-7c79e.firebasestorage.app");
} catch (error) {
  console.warn("Storage initialization failed (safe to ignore if not uploading files):", error);
}
