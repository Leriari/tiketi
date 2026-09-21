import { LogOut, Phone } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Button, Card, EmptyState } from "../../components/ui";
import { formatPhone } from "../../format";

export default function Account() {
  const { user, isAuthed, logout } = useAuth();
  const navigate = useNavigate();

  if (!isAuthed) {
    return (
      <div className="mx-auto max-w-sm px-4 py-8">
        <h1 className="text-h1 text-ink-primary mb-2">Account</h1>
        <EmptyState
          title="No account yet"
          description="Your account is created automatically the first time you buy a ticket."
          actionLabel="Browse events"
          onAction={() => navigate("/events")}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-8 flex flex-col gap-5">
      <h1 className="text-h1 text-ink-primary">Account</h1>
      <Card className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-primary/15 text-brand-primary-on-tint">
          <Phone size={18} />
        </span>
        <div>
          <p className="text-body font-semibold text-ink-primary">{formatPhone(user.phoneNumber)}</p>
          <p className="text-caption text-ink-tertiary">Verified via M-Pesa purchase</p>
        </div>
      </Card>
      <Button variant="secondary" iconLeft={<LogOut size={15} />} onClick={() => { logout(); navigate("/"); }}>
        Log out
      </Button>
    </div>
  );
}
