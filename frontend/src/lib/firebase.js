// Firebase Authentication on the login screen: real SMS codes for phone
// sign-in, and "Continue with Google". Firebase only proves who someone is;
// the ID token it produces is exchanged at POST /auth/firebase for this
// app's own session, after which the Firebase session is signed out.
//
// The web config comes from the backend (GET / -> firebase), so it lives in
// one place (.env) and the SDK is only loaded when it's configured.

let authPromise = null;

function getFirebaseAuth(config) {
  if (!authPromise) {
    authPromise = Promise.all([import("firebase/app"), import("firebase/auth")]).then(([appMod, authMod]) => {
      const app = appMod.getApps()[0] || appMod.initializeApp(config);
      const auth = authMod.getAuth(app);
      auth.useDeviceLanguage();
      return { auth, authMod };
    });
  }
  return authPromise;
}

// Firebase error codes -> sentences a person can act on.
const MESSAGES = {
  "auth/invalid-phone-number": "That phone number isn't valid.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/invalid-verification-code": "That code is wrong. Check the SMS and try again.",
  "auth/code-expired": "That code has expired. Send a new one.",
  "auth/popup-closed-by-user": null, // the person just closed it — not an error
  "auth/cancelled-popup-request": null,
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
  "auth/operation-not-allowed": "This sign-in method isn't enabled in Firebase yet.",
  "auth/unauthorized-domain": "This site isn't an authorised domain in Firebase yet.",
  "auth/captcha-check-failed": "The security check failed. Please try again.",
  "auth/quota-exceeded": "SMS sending is temporarily unavailable. Please try again later.",
  "auth/network-request-failed": "Couldn't reach Firebase. Check your connection.",
};

/** null means "say nothing" (e.g. the user closed the Google pop-up). */
export function firebaseErrorMessage(err, fallback) {
  const code = err?.code;
  if (code && code in MESSAGES) return MESSAGES[code];
  return fallback;
}

/**
 * Sends an SMS code. phoneE164: "+2547…". recaptchaContainerId: an empty
 * element the invisible reCAPTCHA can attach to. Returns { confirm(code) }
 * where confirm resolves to a Firebase ID token.
 */
export async function sendPhoneCode(config, phoneE164, recaptchaContainerId) {
  const { auth, authMod } = await getFirebaseAuth(config);
  // A fresh verifier per send: reusing one after an error or resend fails.
  if (window.__chaintixRecaptcha) {
    try { window.__chaintixRecaptcha.clear(); } catch { /* already gone */ }
  }
  const verifier = new authMod.RecaptchaVerifier(auth, recaptchaContainerId, { size: "invisible" });
  window.__chaintixRecaptcha = verifier;
  const confirmation = await authMod.signInWithPhoneNumber(auth, phoneE164, verifier);
  return {
    async confirm(code) {
      const cred = await confirmation.confirm(code);
      return cred.user.getIdToken();
    },
  };
}

/** Google pop-up. Resolves to a Firebase ID token. */
export async function signInWithGoogle(config) {
  const { auth, authMod } = await getFirebaseAuth(config);
  const provider = new authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await authMod.signInWithPopup(auth, provider);
  return cred.user.getIdToken();
}

/** Drop the Firebase session once this app's own session exists. */
export async function firebaseSignOut(config) {
  if (!authPromise) return;
  const { auth, authMod } = await getFirebaseAuth(config);
  await authMod.signOut(auth).catch(() => {});
}
