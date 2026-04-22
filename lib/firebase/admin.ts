/**
 * Firebase Admin SDK initialization.
 * Used by server-side code (API routes, webhook handlers).
 * See PRD §5 (Database / Auth) and §7.1 (Whop webhook flow).
 *
 * Requires: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.
 * In production these come from Secret Manager via apphosting.yaml.
 */
import {
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";

let _adminApp: App | null = null;

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

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin SDK not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.",
    );
  }

  _adminApp = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });

  return _adminApp;
}

// TODO: export getAdminAuth, getAdminFirestore, getAdminStorage helpers as needed
