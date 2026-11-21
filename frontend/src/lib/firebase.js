import { initializeApp, getApps } from "@firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
} from "@firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() || "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim() || "",
};

export function isFirebaseAuthConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);
}

let cachedAuth = null;

function getFirebaseAuthInstance() {
  if (!isFirebaseAuthConfigured()) return null;
  if (cachedAuth) return cachedAuth;
  const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  cachedAuth = getAuth(app);
  return cachedAuth;
}

function normalizeUser(fbUser) {
  if (!fbUser) return null;
  const isGuest = Boolean(fbUser.isAnonymous);
  return {
    uid: fbUser.uid,
    displayName: isGuest
      ? "Guest"
      : fbUser.displayName || fbUser.email?.split("@")[0] || "Learner",
    email: fbUser.email || "",
    photoURL: fbUser.photoURL || "",
    isGuest,
  };
}

/**
 * Returns the real Firebase ID token for the currently signed-in (or anonymous) user.
 * Returns null if no Firebase user is active.
 */
export async function getCurrentIdToken(forceRefresh = false) {
  const auth = getFirebaseAuthInstance();
  if (!auth?.currentUser) return null;
  try {
    return await auth.currentUser.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

/**
 * Guest / Anonymous sign-in:
 * Uses Firebase Anonymous Auth when enabled (producing a real verifiable ID token),
 * falling back cleanly to a local unauthenticated Guest session if Anonymous Auth
 * is not yet enabled in the Firebase console.
 */
export async function signInAsGuest() {
  const auth = getFirebaseAuthInstance();
  if (auth) {
    try {
      const cred = await signInAnonymously(auth);
      return { ...normalizeUser(cred.user), role: "trader", isGuest: true };
    } catch {
      // Anonymous provider may not be enabled in Firebase Console — fall back cleanly
    }
  }
  return {
    uid: null,
    displayName: "Guest",
    email: "",
    photoURL: "",
    role: "trader",
    isGuest: true,
  };
}

export function subscribeToAuth(callback) {
  const auth = getFirebaseAuthInstance();
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, (fbUser) => {
    callback(normalizeUser(fbUser));
  });
}

export async function signInWithGoogle() {
  const auth = getFirebaseAuthInstance();
  if (!auth) {
    throw new Error(
      "Firebase Auth isn't configured in frontend/.env yet. Add NEXT_PUBLIC_FIREBASE_* keys or use Continue as Guest."
    );
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await signInWithPopup(auth, provider);
  return normalizeUser(cred.user);
}

export async function signInWithEmail(email, password, { createAccount = false } = {}) {
  const auth = getFirebaseAuthInstance();
  if (!auth) {
    throw new Error(
      "Firebase Auth isn't configured in frontend/.env yet. Add NEXT_PUBLIC_FIREBASE_* keys or use Continue as Guest."
    );
  }
  const cred = createAccount
    ? await createUserWithEmailAndPassword(auth, email.trim(), password)
    : await signInWithEmailAndPassword(auth, email.trim(), password);
  return normalizeUser(cred.user);
}

export async function signOutUser() {
  const auth = getFirebaseAuthInstance();
  if (auth) {
    await signOut(auth);
  }
}
