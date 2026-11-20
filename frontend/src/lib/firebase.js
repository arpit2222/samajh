import { initializeApp, getApps } from "@firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
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
  return {
    uid: fbUser.uid,
    displayName: fbUser.displayName || fbUser.email?.split("@")[0] || "Learner",
    email: fbUser.email || "",
    photoURL: fbUser.photoURL || "",
    isGuest: false,
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
