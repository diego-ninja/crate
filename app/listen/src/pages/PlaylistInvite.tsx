import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";

export function PlaylistInvite() {
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<{ playlist_id: number }>(`/api/playlists/invites/${token}/accept`, "POST", {})
      .then((response) => {
        if (cancelled) return;
        toast.success("You joined the collaborative playlist");
        navigate(`/playlist/${response.playlist_id}`, { replace: true });
      })
      .catch(() => {
        if (cancelled) return;
        toast.error("Playlist invite is invalid or expired");
        navigate("/library?tab=playlists", { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, token]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <Loader2 size={22} className="animate-spin text-primary" />
      <div>
        <p className="text-lg font-medium text-foreground">Joining playlist…</p>
        <p className="text-sm text-muted-foreground">We are validating the invite and adding you as a collaborator.</p>
      </div>
    </div>
  );
}
