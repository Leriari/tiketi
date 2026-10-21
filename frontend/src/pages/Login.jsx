import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Smartphone, KeyRound, Wand2, ArrowLeft } from "lucide-react";
import { api, ApiError, usingMockBackend } from "../api";
import { useAuth } from "../context/AuthContext";
import { Input, Button } from "../components/ui";
import { isValidKenyanPhone, normalizeKenyanPhone } from "../format";
import { sendPhoneCode, signInWithGoogle, firebaseSignOut, firebaseErrorMessage } from "../lib/firebase";
import BrandMark from "../components/BrandMark";

const RESEND_COOLDOWN_SECONDS = 30;
const RECAPTCHA_ID = "firebase-recaptcha";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

// The login screen. Every guard in the app redirects here when there's no
// valid session (routeGuards.jsx, liveApi.js's handleExpiredSession), with
// `?return=` carrying back where the person was headed.
//
// Two backends for the same screen:
// - Google: through Firebase whenever it's configured (GET / -> firebase).
// - Phone codes: by real SMS through Firebase when firebase.phoneAuth is on,
//   otherwise this backend's own OTP (request-otp/verify-otp), with the
//   code shown in a dev panel in development.
// Firebase ID tokens are exchanged at /auth/firebase for this app's session.
export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Only ever an in-app path — never an absolute URL someone put in a link.
  const rawReturn = params.get("return") || "/";
  const returnTo = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/";
  const { isAuthed, login, loginWithOtp, loginWithFirebase, completeGooglePhone } = useAuth();

  const [step, setStep] = useState("phone"); // phone | code
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [devOtp, setDevOtp] = useState(null);
  const [isDev, setIsDev] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef(null);

  const [firebaseConfig, setFirebaseConfig] = useState(null);
  const firebasePhone = Boolean(firebaseConfig?.phoneAuth);
  // What this server can do (GET /): "otp" = codes are delivered;
  // "demo_numbers" = no SMS, only configured demo numbers have codes.
  const [phoneLogin, setPhoneLogin] = useState("otp");
  // "unverified" = a first Google sign-in records the number without a code.
  const [googlePhoneMode, setGooglePhoneMode] = useState("sms");
  const confirmationRef = useRef(null); // Firebase SMS confirmation in flight
  // After "Continue with Google" for a Google account not yet linked to a
  // phone: { linkToken, email }. The phone steps then finish and link.
  const [googleLink, setGoogleLink] = useState(null);
  const [googleError, setGoogleError] = useState(null);

  useEffect(() => {
    api.health().then((h) => {
      setIsDev(h.env === "development");
      if (!usingMockBackend) setFirebaseConfig(h.firebase || null);
      if (h.phone_login) setPhoneLogin(h.phone_login);
      if (h.google_phone_confirmation) setGooglePhoneMode(h.google_phone_confirmation);
    }).catch(() => {});
  }, []);

  useEffect(() => () => clearInterval(cooldownRef.current), []);

  function startCooldown() {
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) {
          clearInterval(cooldownRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  // Exchange a Firebase ID token for a session; the Firebase session itself
  // isn't kept (this app's own token is the session).
  async function finishWithFirebase(idToken, linkToken) {
    const result = await loginWithFirebase(idToken, linkToken);
    await firebaseSignOut(firebaseConfig);
    return result;
  }

  async function continueWithGoogle() {
    setGoogleError(null);
    setSubmitting(true);
    try {
      const idToken = await signInWithGoogle(firebaseConfig);
      const result = await finishWithFirebase(idToken);
      if (result.needsPhone) {
        setGoogleLink({ linkToken: result.linkToken, email: result.email });
        setStep("phone");
        return;
      }
      navigate(returnTo, { replace: true });
    } catch (err) {
      const message = err instanceof ApiError
        ? err.message
        : firebaseErrorMessage(err, "Google sign-in failed. Try again, or use your phone number.");
      if (message) setGoogleError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function sendCode(e) {
    e?.preventDefault();
    if (!isValidKenyanPhone(phone)) {
      setPhoneError("Enter a valid Kenyan phone number, e.g. 0712 345 678");
      return;
    }
    if (googleLink && googlePhoneMode === "unverified") {
      // No code on this deployment: the number is recorded as given.
      setPhoneError(null);
      setSubmitting(true);
      try {
        await completeGooglePhone(googleLink.linkToken, normalizeKenyanPhone(phone));
        navigate(returnTo, { replace: true });
      } catch (err) {
        setPhoneError(err instanceof ApiError ? err.message : "Couldn't finish signing in. Try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setPhoneError(null);
    setSubmitting(true);
    setDevOtp(null);
    try {
      if (usingMockBackend) {
        // The mock backend has no code step at all.
        await login(normalizeKenyanPhone(phone));
        navigate(returnTo, { replace: true });
        return;
      }
      if (firebasePhone) {
        confirmationRef.current = await sendPhoneCode(firebaseConfig, `+${normalizeKenyanPhone(phone)}`, RECAPTCHA_ID);
      } else {
        const res = await api.requestOtp(normalizeKenyanPhone(phone));
        if (res.dev_otp) setDevOtp(res.dev_otp); // only ever present in development
      }
      setStep("code");
      startCooldown();
    } catch (err) {
      setPhoneError(err instanceof ApiError ? err.message : firebaseErrorMessage(err, "Couldn't send a code. Try again."));
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCode(e) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setCodeError("Enter the 6-digit code.");
      return;
    }
    setCodeError(null);
    setSubmitting(true);
    try {
      if (firebasePhone) {
        const idToken = await confirmationRef.current.confirm(code);
        await finishWithFirebase(idToken, googleLink?.linkToken);
      } else {
        await loginWithOtp(normalizeKenyanPhone(phone), code, googleLink?.linkToken);
      }
      navigate(returnTo, { replace: true });
    } catch (err) {
      // Backend messages (rate limits, a Google account already linked
      // elsewhere) and Firebase's (wrong/expired code) read as sentences.
      setCodeError(err instanceof ApiError ? err.message : firebaseErrorMessage(err, "Couldn't verify that code. Try again."));
    } finally {
      setSubmitting(false);
    }
  }

  function changeNumber() {
    setStep("phone");
    setCode("");
    setCodeError(null);
    setDevOtp(null);
    confirmationRef.current = null;
    clearInterval(cooldownRef.current);
    setResendCooldown(0);
  }

  // No SMS on this server: Google is the main way in; phone codes are only
  // for the configured demo numbers.
  const googleFirst = Boolean(firebaseConfig) && phoneLogin === "demo_numbers" && !googleLink;

  // Already logged in (e.g. opened /login directly, or pressed Back after
  // logging in) — nothing to do here. Not applied mid-submit: completeAuth
  // sets the user before the navigate() runs.
  if (isAuthed && !submitting) return <Navigate to={returnTo} replace />;

  return (
    <div className="min-h-screen app-backdrop">
    <div className="min-h-screen flex flex-col justify-center px-5 py-10 max-w-md mx-auto">
      <Link to="/" className="inline-flex items-center gap-1.5 text-body-sm text-ink-tertiary hover:text-ink-primary mb-6 self-start">
        <ArrowLeft size={14} /> Back to events
      </Link>
      <div className="flex items-center gap-2.5 mb-2">
        <Link to="/" title="Home" className="rounded-md"><BrandMark size={34} /></Link>
        <h1 className="text-h2 text-ink-primary font-semibold tracking-[-0.02em]">Log in</h1>
      </div>
      <p className="text-body-sm text-ink-tertiary mb-8">
        {usingMockBackend
          ? "Demo mode (mock backend): any Kenyan number logs you in, no code needed."
          : googleFirst
            ? "Sign in with your Google account. New here? Your account is created on the spot."
            : "We'll send a one-time code to your phone. New numbers get an account automatically."}
      </p>

      {googleFirst && (
        <div className="flex flex-col gap-2 mb-6">
          <Button type="button" size="lg" iconLeft={<GoogleMark />} onClick={continueWithGoogle} disabled={submitting} loading={submitting}>
            Continue with Google
          </Button>
          {googleError && <p role="alert" className="text-caption text-danger text-center">{googleError}</p>}
          <div className="flex items-center gap-3 text-caption text-ink-tertiary pt-3">
            <span className="h-px flex-1 bg-line-subtle" /> demo accounts <span className="h-px flex-1 bg-line-subtle" />
          </div>
        </div>
      )}

      {googleLink && (
        <div className="rounded-md border border-line bg-surface px-4 py-3 mb-4 text-body-sm text-ink-secondary">
          <p className="font-semibold text-ink-primary">
            Signed in with Google{googleLink.email ? ` as ${googleLink.email}` : ""}.
          </p>
          <p className="mt-0.5">
            {googlePhoneMode === "unverified"
              ? "Last step: your M-Pesa number. It's the number your ticket payments are requested from. You'll only need to do this once."
              : "One more step: confirm your phone number. ChainTix uses it for M-Pesa payments and your tickets. You'll only need to do this once."}
          </p>
          <button type="button" onClick={() => { setGoogleLink(null); changeNumber(); }} className="mt-1 text-caption text-ink-tertiary underline">
            Cancel Google sign-in
          </button>
        </div>
      )}

      {step === "phone" && (
        <form onSubmit={sendCode} className="flex flex-col gap-4">
          <Input
            label={googleLink && googlePhoneMode === "unverified" ? "M-Pesa number" : "Phone number"}
            hint={googleFirst ? "Phone codes only work for demo accounts on this site." : undefined}
            leadingIcon={<Smartphone size={15} />}
            placeholder="0712 345 678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={phoneError}
            autoFocus
          />
          <Button type="submit" size="lg" variant={googleFirst ? "secondary" : "primary"} disabled={submitting} loading={submitting}>
            {googleLink && googlePhoneMode === "unverified" ? "Continue" : "Send code"}
          </Button>

          {firebaseConfig && !googleLink && !googleFirst && (
            <>
              <div className="flex items-center gap-3 text-caption text-ink-tertiary">
                <span className="h-px flex-1 bg-line-subtle" /> or <span className="h-px flex-1 bg-line-subtle" />
              </div>
              <Button type="button" variant="secondary" size="lg" iconLeft={<GoogleMark />} onClick={continueWithGoogle} disabled={submitting}>
                Continue with Google
              </Button>
              {googleError && <p role="alert" className="text-caption text-danger text-center">{googleError}</p>}
            </>
          )}
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verifyCode} className="flex flex-col gap-4">
          <p className="text-body-sm text-ink-tertiary -mt-2">Code sent to {phone}.</p>

          {isDev && devOtp && (
            <div className="rounded-md border border-warning bg-warning-bg px-4 py-3 flex flex-col gap-2">
              <p className="text-caption font-semibold text-warning-on-tint uppercase tracking-wide">
                Development mode — OTP delivery simulated
              </p>
              <div className="flex items-center justify-between gap-3">
                <span className="text-h3 font-bold tabular-nums text-ink-primary">{devOtp}</span>
                <Button type="button" variant="secondary" size="sm" iconLeft={<Wand2 size={14} />} onClick={() => setCode(devOtp)}>
                  Fill code
                </Button>
              </div>
            </div>
          )}

          <Input
            label="6-digit code"
            leadingIcon={<KeyRound size={15} />}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            error={codeError}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
          />

          <Button type="submit" size="lg" disabled={submitting} loading={submitting}>
            Verify &amp; continue
          </Button>

          <div className="flex items-center justify-between text-body-sm">
            <button type="button" onClick={changeNumber} className="text-ink-tertiary underline">
              Change number
            </button>
            <button
              type="button"
              onClick={sendCode}
              disabled={resendCooldown > 0}
              className="text-brand-primary-on-tint disabled:text-ink-tertiary disabled:no-underline underline"
            >
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
            </button>
          </div>
        </form>
      )}

      {/* Firebase's invisible reCAPTCHA (abuse protection for SMS) attaches here. */}
      <div id={RECAPTCHA_ID} />
    </div>
    </div>
  );
}
