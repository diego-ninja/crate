import { useEffect } from "react";
import { useNavigate } from "react-router";

import { setAuthToken } from "@/lib/api";
import { getOAuthCallbackPayload } from "@/lib/capacitor";

export function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const { token, next } = getOAuthCallbackPayload(window.location.search);
    if (token) {
      setAuthToken(token);
      navigate(next, { replace: true });
    } else {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  return null;
}
