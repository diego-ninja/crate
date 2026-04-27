import { useEffect } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "@/contexts/AuthContext";
import { persistOAuthCallbackPayload } from "@/lib/capacitor";

export function AuthCallback() {
  const navigate = useNavigate();
  const { refetch } = useAuth();

  useEffect(() => {
    const { handled, next } = persistOAuthCallbackPayload(window.location.search);
    if (!handled) {
      navigate("/login", { replace: true });
      return;
    }

    void refetch().then(() => {
      navigate(next, { replace: true });
    });
  }, [navigate, refetch]);

  return null;
}
