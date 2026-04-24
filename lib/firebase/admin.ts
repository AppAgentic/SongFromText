/**
 * Firebase Admin SDK initialization.
 * Used by server-side code (API routes, webhook handlers).
 * See PRD §5 (Database / Auth) and §7.1 (Whop webhook flow).
 *
 * App Hosting provides application default credentials automatically.
 * Local dev can still use FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.
 */
import {
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let _adminApp: App | null = null;
let _adminDb: Firestore | null = null;

export function getAdminApp(): App {
  if (_adminApp) return _adminApp;

  const existing = getApps();
  if (existing.length) {
    _adminApp = existing[0];
    return _adminApp;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (clientEmail && privateKey) {
    if (!projectId) {
      throw new Error("FIREBASE_PROJECT_ID is required when using service account env vars.");
    }

    _adminApp = initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });

    return _adminApp;
  }

  _adminApp = initializeApp(projectId ? { projectId } : undefined);

  return _adminApp;
}

export function getAdminDb(): Firestore {
  if (_adminDb) return _adminDb;
  _adminDb = getFirestore(getAdminApp());
  return _adminDb;
}

// TODO: export getAdminAuth, getAdminStorage helpers as needed
