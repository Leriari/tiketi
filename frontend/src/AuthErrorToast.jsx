import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useToast } from "./components/ui/Toast";

// Work Order 04 C2 — route guards redirect with `state.authError` rather
// than a blank page; this is the one place that turns it into something
// the person actually sees, then clears it so navigating back and forth
// doesn't replay the same toast.
export default function AuthErrorToast() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (location.state?.authError) {
      toast.push(location.state.authError, { tone: "danger" });
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate, toast]);

  return null;
}
