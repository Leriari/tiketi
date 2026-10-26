import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { User, Mail } from "lucide-react";
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { Input, Button } from "../components/ui";
import BrandMark from "../components/BrandMark";

/**
 * The one-time step after a new account's first sign-in (ProfileGate in
 * App.jsx sends people here): full name, for tickets, guest lists and
 * receipts, and an email address for receipts. Google sign-ins arrive with
 * their email already filled in.
 */
export default function Welcome() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rawReturn = params.get("return") || "/";
  const returnTo = rawReturn.startsWith("/") && !rawReturn.startsWith("//") && !rawReturn.startsWith("/welcome") ? rawReturn : "/";
  const { isAuthed, roles, refreshRoles } = useAuth();

  const [name, setName] = useState(roles.displayName || "");
  const [email, setEmail] = useState(roles.email || "");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  if (!isAuthed) return <Navigate to={`/login?return=${encodeURIComponent(returnTo)}`} replace />;

  async function submit(e) {
    e.preventDefault();
    const next = {};
    if (name.trim().split(/\s+/).filter(Boolean).length < 2) next.name = "Enter your first and last name.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) next.email = "Enter a valid email address, e.g. name@example.com.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      await api.updateProfile({ displayName: name.trim(), email: email.trim() });
      await refreshRoles();
      navigate(returnTo, { replace: true });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Couldn't save that. Check your connection and try again.";
      setErrors(/email/i.test(message) ? { email: message } : { form: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen app-backdrop">
      <div className="min-h-screen flex flex-col justify-center px-5 py-10 max-w-md mx-auto">
        <div className="flex items-center gap-2.5 mb-2">
          <Link to="/" title="Home" className="rounded-md"><BrandMark size={34} /></Link>
          <h1 className="text-h2 text-ink-primary font-semibold tracking-[-0.02em]">Welcome to ChainTix</h1>
        </div>
        <p className="text-body-sm text-ink-tertiary mb-8">
          One last step. Your name goes on your tickets and receipts, and we email your receipts to you.
          You only do this once.
        </p>

        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Input
            label="Full name"
            leadingIcon={<User size={15} />}
            placeholder="e.g. Wanjiru Kamau"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            autoFocus={!name}
            required
          />
          <Input
            label="Email address"
            type="email"
            leadingIcon={<Mail size={15} />}
            placeholder="you@example.com"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
            hint={roles.googleLinked && roles.email ? "From your Google account. You can change it." : "Where we send your ticket receipts."}
            required
          />
          {errors.form && <p role="alert" className="text-body-sm text-danger">{errors.form}</p>}
          <Button type="submit" size="lg" loading={busy}>Continue</Button>
          <p className="text-caption text-ink-tertiary">
            ChainTix uses these only for your tickets and receipts, and shows your name to an event's organiser on its guest list.
          </p>
        </form>
      </div>
    </div>
  );
}
