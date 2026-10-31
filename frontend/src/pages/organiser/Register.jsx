import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarPlus, ScanLine, ShieldCheck, Wallet, Building2 } from "lucide-react";
import { api, ApiError } from "../../api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/ui/Toast";
import { Card, Input, Checkbox, Button } from "../../components/ui";
import { formatPhone, isValidKenyanPhone, normalizeKenyanPhone } from "../../format";

const PERKS = [
  { icon: CalendarPlus, title: "Publish events in minutes", text: "Tiers, sales windows, guest lists and complimentary tickets." },
  { icon: Wallet, title: "Get paid by M-Pesa and card", text: "Buyers pay at checkout; track sales and earnings live." },
  { icon: ShieldCheck, title: "Tickets that can't be faked", text: "Every ticket is recorded on the blockchain, with capped, royalty-paying resale." },
  { icon: ScanLine, title: "Scan at the door with a phone", text: "Camera scanning online, or enrolled devices that work offline." },
];

/**
 * "Become an organiser": creates an organisation with the signed-in person
 * as its owner (POST /organisations/), then opens its Organiser Console.
 * The organisation starts pending until a platform admin reviews it.
 */
export default function Register() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, roles, refreshRoles, switchOrganisation } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(roles.email || "");
  const [phone, setPhone] = useState(user?.phoneNumber ? formatPhone(user.phoneNumber) : "");
  const [kraPin, setKraPin] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function validate() {
    const next = {};
    if (name.trim().length < 2) next.name = "Enter your organisation's name.";
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) next.email = "Enter a valid email, e.g. events@example.com";
    if (phone.trim() && !isValidKenyanPhone(phone)) next.phone = "Enter a valid Kenyan phone number, e.g. 0712 345 678";
    if (kraPin.trim() && !/^[A-Za-z]\d{9}[A-Za-z]$/.test(kraPin.trim())) next.kraPin = "A KRA PIN looks like P051234567X";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e) {
    e.preventDefault();
    if (!validate() || !agreed) return;
    setBusy(true);
    setError(null);
    try {
      const org = await api.createOrganisation({
        business_name: name.trim(),
        contact_email: email.trim() || null,
        contact_phone: phone.trim() ? normalizeKenyanPhone(phone) : null,
        kra_pin: kraPin.trim() || null,
      });
      await refreshRoles();
      switchOrganisation(org.id);
      toast.push(`${org.business_name} is set up. Welcome to your Organiser Console.`, { tone: "success" });
      navigate("/organiser", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create your organisation.");
      setBusy(false);
    }
  }

  const existing = roles.organisations;

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-8 grid lg:grid-cols-[1fr_minmax(0,28rem)] gap-8 items-start">
      <div className="flex flex-col gap-5">
        <div>
          <p className="text-label uppercase tracking-[0.06em] text-brand-primary-on-tint font-medium">For organisers</p>
          <h1 className="text-display text-ink-primary mt-1">Sell tickets to your events on ChainTix</h1>
          <p className="text-body text-ink-secondary mt-2">
            Register your organisation and you'll go straight into your Organiser Console. It's free to set up.
          </p>
        </div>
        <ul className="grid sm:grid-cols-2 gap-3">
          {PERKS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex items-start gap-3 rounded-md border border-line-subtle bg-surface px-4 py-3">
              <Icon size={18} className="flex-none mt-0.5 text-brand-primary" aria-hidden="true" />
              <span className="flex flex-col">
                <span className="text-body-sm font-semibold text-ink-primary">{title}</span>
                <span className="text-caption text-ink-tertiary">{text}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="text-body-sm text-ink-secondary">
          <p className="font-semibold text-ink-primary">What happens next</p>
          <ol className="list-decimal pl-5 mt-1 flex flex-col gap-1">
            <li>Your console opens right away, so you can set up your first event and invite your team.</li>
            <li>ChainTix reviews new organisations. Until then, an event may need approval before it goes on sale.</li>
            <li>Add payout details in the console so your earnings have somewhere to go.</li>
          </ol>
        </div>
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Building2 size={18} className="text-brand-primary" aria-hidden="true" />
          <h2 className="text-h3 text-ink-primary">Register your organisation</h2>
        </div>

        {existing.length > 0 && (
          <p className="text-caption text-ink-tertiary">
            You're already in {existing.map((o) => o.businessName).join(", ")}.{" "}
            <Link to="/organiser" className="underline">Open the console</Link>, or register another organisation for a separate business.
          </p>
        )}

        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Input
            label="Organisation name"
            placeholder="e.g. Nairobi Live Events"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            hint="Shown to buyers on your events."
            autoComplete="organization"
            required
          />
          <Input
            label="Contact email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
            hint="Where ChainTix contacts you about your organisation."
          />
          <Input
            label="Contact phone"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0712 345 678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={errors.phone}
          />
          <Input
            label="KRA PIN (optional)"
            placeholder="P051234567X"
            value={kraPin}
            onChange={(e) => setKraPin(e.target.value.toUpperCase())}
            error={errors.kraPin}
            hint="Helps ChainTix verify your organisation. You can add it later."
          />
          <Checkbox
            checked={agreed}
            onChange={setAgreed}
            label="I'm authorised to sell tickets for this organisation, and I agree to ChainTix's organiser terms."
          />
          {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
          <Button type="submit" loading={busy} disabled={!agreed || busy}>Create organisation</Button>
        </form>
      </Card>
    </div>
  );
}
