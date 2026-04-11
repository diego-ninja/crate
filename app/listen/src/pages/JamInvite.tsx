import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";

export function JamInvite() {
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<{ room: { id: string; name: string } }>(`/api/jam/rooms/invites/${token}/join`, "POST", {})
      .then((response) => {
        if (cancelled) return;
        toast.success(`Joined ${response.room.name}`);
        navigate(`/jam/rooms/${response.room.id}`, { replace: true });
      })
      .catch(() => {
        if (cancelled) return;
        toast.error("Invite is invalid or expired");
        navigate("/jam", { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, token]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <Loader2 size={22} className="animate-spin text-primary" />
      <div>
        <p className="text-lg font-medium text-foreground">Joining room…</p>
        <p className="text-sm text-muted-foreground">We are validating the invite and adding you to the session.</p>
      </div>
    </div>
  );
}
