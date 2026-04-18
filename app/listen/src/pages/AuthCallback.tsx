import { useEffect } from "react";
import { useNavigate } from "react-router";

import { setAuthToken } from "@/lib/api";

export function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const next = params.get("next") || "/";
    if (token) {
      setAuthToken(token);
      navigate(next, { replace: true });
    } else {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  return null;
}
