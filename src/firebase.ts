/**
 * Firebase client initialisation.
 *
 * Reads config from Vite env vars (see .env.example) and points at the local
 * emulators when VITE_USE_FIREBASE_EMULATORS is set, so development never
 * touches a real project.
 */

import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, Timestamp } from 'firebase/firestore';
import type { Timestamp as SchemaTimestamp } from './lib/schema.js';

function required(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill it from the ` +
        `Firebase console (Project settings > Your apps).`,
    );
  }
  return value;
}

const config: FirebaseOptions = {
  apiKey: required('VITE_FIREBASE_API_KEY'),
  authDomain: required('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: required('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: required('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: required('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: required('VITE_FIREBASE_APP_ID'),
};

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);

if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  console.info('[firebase] using local emulators — no real project is being touched');
}

/**
 * The `TimestampFactory` the DualDate builders expect. Passing it in keeps
 * src/lib free of any Firebase import, so the calendar and tax logic stay
 * testable in plain Node.
 */
export const toTimestamp = (date: Date): SchemaTimestamp => Timestamp.fromDate(date);
