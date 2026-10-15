import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Smartphone, KeyRound, Wand2 } from "lucide-react";
import { api, ApiError, usingMockBackend } from "../api";
import { useAuth } from "../context/AuthContext";
import { Input, Button } from "../components/ui";
import { isValidKenyanPhone, normalizeKenyanPhone } from "../format";

const RESEND_COOLDOWN_SECONDS = 30;

// Work Order 05 A2/A3 — the real login screen. Every guard in the app
// redirects here when there's no valid session (routeGuards.jsx,
// liveApi.js's handleExpiredSession), with `?return=` carrying back where
// the person was headed.
export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get("return") || "/";
  const { login, loginWithOtp } = useAuth();

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

  useEffect(() => {
    api.health().then((h) => setIsDev(h.env === "development")).catch(() => {});
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

  async function sendCode(e) {
    e?.preventDefault();
    if (!isValidKenyanPhone(phone)) {
      setPhoneError("Enter a valid Kenyan phone number, e.g. 0712 345 678");
      return;
    }
    setPhoneError(null);
    setSubmitting(true);
    setDevOtp(null);
    try {
      if (usingMockBackend) {
        // mockApi has no request-otp/verify-otp concept at all (Work Order
        // 05 rule 4: frontend/src/mock/ is untouched) — a single step here
        // matches what the mock backend actually supports.
        await login(normalizeKenyanPhone(phone));
        navigate(returnTo, { replace: true });
        return;
      }
      const res = await api.requestOtp(normalizeKenyanPhone(phone));
      if (res.dev_otp) setDevOtp(res.dev_otp); // only ever present in development
      setStep("code");
      startCooldown();
    } catch (err) {
      setPhoneError(err instanceof ApiError ? err.message : "Couldn't send a code. Try again.");
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
      await loginWithOtp(normalizeKenyanPhone(phone), code);
      navigate(returnTo, { replace: true });
    } catch (err) {
      // Surfaces the backend's own messages plainly — including the
      // attempt-lockout and rate-limit cases (Work Order 04 A2/A3), which
      // read as ordinary sentences ("Invalid or expired OTP", "Too many
      // requests. Please try again later.") rather than a raw HTTP error.
      setCodeError(err instanceof ApiError ? err.message : "Couldn't verify that code. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function changeNumber() {
    setStep("phone");
    setCode("");
    setCodeError(null);
    setDevOtp(null);
    clearInterval(cooldownRef.current);
    setResendCooldown(0);
  }

  return (
    <div className="min-h-screen flex flex-col justify-center px-5 py-10 max-w-md mx-auto">
      <div className="flex items-center gap-2.5 mb-8">
        <span className="h-9 w-9 rounded-md bg-brand-accent flex items-center justify-center text-brand-accent-ink font-black flex-none">C</span>
        <h1 className="text-h2 text-ink-primary font-bold">Log in</h1>
      </div>

      {step === "phone" && (
        <form onSubmit={sendCode} className="flex flex-col gap-4">
          <Input
            label="Phone number"
            leadingIcon={<Smartphone size={15} />}
            placeholder="0712 345 678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={phoneError}
            autoFocus
          />
          <Button type="submit" size="lg" disabled={submitting} loading={submitting}>
            Send code
          </Button>
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
    </div>
  );
}
