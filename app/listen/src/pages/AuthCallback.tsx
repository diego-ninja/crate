import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "@/contexts/AuthContext";
import { persistOAuthCallbackPayload } from "@/lib/capacitor";

export function AuthCallback() {
  const navigate = useNavigate();
  const { user, loading, refetch } = useAuth();
  const nextRef = useRef("/");
  const awaitingAuthRef = useRef(false);

  useEffect(() => {
    const { handled, next } = persistOAuthCallbackPayload(window.location.search);
    if (!handled) {
      navigate("/login", { replace: true });
      return;
    }

    nextRef.current = next;
    awaitingAuthRef.current = true;
    void refetch();
  }, [navigate, refetch]);

  useEffect(() => {
    if (!awaitingAuthRef.current || loading) {
      return;
    }

    awaitingAuthRef.current = false;
    if (user) {
      navigate(nextRef.current, { replace: true });
    } else {
      navigate("/login", { replace: true });
    }
  }, [loading, navigate, user]);

  return null;
}
