import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Card, Input, Select, Textarea, Button } from "../../components/ui";

export default function Contact() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    await new Promise((r) => setTimeout(r, 500));
    setBusy(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <Card className="flex flex-col items-center text-center gap-3">
          <CheckCircle2 size={32} className="text-success" />
          <h2 className="text-h3 text-ink-primary">Message sent</h2>
          <p className="text-body-sm text-ink-secondary">We'll get back to you within 24 hours.</p>
          <Button variant="secondary" onClick={() => setSent(false)}>Send another</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Contact Support</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Select label="What's this about?" required>
          <option>A listing issue</option>
          <option>A wallet or withdrawal issue</option>
          <option>A dispute</option>
          <option>Something else</option>
        </Select>
        <Textarea label="Message" placeholder="Tell us what's going on…" required rows={5} />
        <Input label="Best number to reach you" placeholder="0712 345 678" required />
        <Button type="submit" loading={busy}>Send message</Button>
      </form>
    </div>
  );
}
