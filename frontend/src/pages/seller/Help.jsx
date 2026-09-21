import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";

const FAQS = [
  {
    q: "How long until I get paid after my ticket sells?",
    a: "The moment a buyer pays, your proceeds appear in your wallet as Pending. They move to Available 2 days after the event ends, and you can withdraw to M-Pesa from there.",
  },
  {
    q: "Why was my listing paused instead of cancelled?",
    a: "If an organiser lowers an event's resale price cap after you've listed, any listing that now exceeds the new maximum is paused rather than deleted — you keep the listing and can reprice it back within the new limit to relist.",
  },
  {
    q: "Can I sell a ticket above face value?",
    a: "Only up to the cap the organiser set for that event — usually shown as a percentage of face value on the listing screen. The cap is enforced by ChainTix, so the app won't let you enter a higher price.",
  },
  {
    q: "What happens if my ticket doesn't sell?",
    a: "It stays listed until you cancel it, the event happens, or the listing window closes (2 hours before the event). You can still use the ticket yourself at any time by cancelling the listing first.",
  },
  {
    q: "Is a resold ticket guaranteed authentic?",
    a: "Yes — every ticket is a verified digital credential, and ownership transfers atomically when a sale completes, so a resold ticket is exactly as authentic as the original.",
  },
];

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line-subtle py-3">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="text-body font-medium text-ink-primary">{q}</span>
        <ChevronDown size={16} className={cn("text-ink-tertiary transition-transform duration-150 flex-none", open && "rotate-180")} />
      </button>
      {open && <p className="text-body-sm text-ink-secondary mt-2">{a}</p>}
    </div>
  );
}

export default function Help() {
  return (
    <div className="mx-auto max-w-2xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Help &amp; FAQs</h1>
      <div>
        {FAQS.map((f) => <FaqItem key={f.q} {...f} />)}
      </div>
    </div>
  );
}
