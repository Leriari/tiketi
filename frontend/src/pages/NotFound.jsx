import { Link } from "react-router-dom";
import { Compass, Ticket, Repeat } from "lucide-react";
import { Button } from "../components/ui";

/** Unknown address: say so, and offer the obvious ways back. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-20 flex flex-col items-center text-center gap-4">
      <span className="text-label uppercase tracking-[0.08em] text-ink-tertiary">Error 404</span>
      <h1 className="text-h1 text-ink-primary">This page doesn't exist</h1>
      <p className="text-body-sm text-ink-secondary">The link may be old or mistyped. Here's where you can go instead:</p>
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <Link to="/"><Button iconLeft={<Compass size={15} />}>Browse events</Button></Link>
        <Link to="/tickets"><Button variant="secondary" iconLeft={<Ticket size={15} />}>My tickets</Button></Link>
        <Link to="/resale"><Button variant="secondary" iconLeft={<Repeat size={15} />}>Resale</Button></Link>
      </div>
    </div>
  );
}
