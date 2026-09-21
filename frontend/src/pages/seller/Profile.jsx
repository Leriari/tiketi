import { LogOut, Phone, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Card, Button, Badge } from "../../components/ui";
import { formatPhone } from "../../format";

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-lg px-4 lg:px-6 py-6 flex flex-col gap-5">
      <h1 className="text-h1 text-ink-primary">Profile &amp; Verification</h1>
      <Card className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-primary/15 text-brand-primary-on-tint flex-none">
          <Phone size={18} />
        </span>
        <div>
          <p className="text-body font-semibold text-ink-primary">{user ? formatPhone(user.phoneNumber) : "—"}</p>
          <Badge tone="verified" icon={<ShieldCheck size={11} />} className="mt-1">Phone verified</Badge>
        </div>
      </Card>
      <Button variant="secondary" iconLeft={<LogOut size={15} />} onClick={() => { logout(); navigate("/"); }}>
        Log out
      </Button>
    </div>
  );
}
