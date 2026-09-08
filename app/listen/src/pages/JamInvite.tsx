import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2 } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { api } from "@/lib/api";

export function JamInvite() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<{ room: { id: string; name: string } }>(
      `/api/jam/rooms/invites/${token}/join`,
      "POST",
      {},
    )
      .then((response) => {
        if (cancelled) return;
        toast.success(
          t("jamInvite.toasts.joined", { name: response.room.name }),
        );
        navigate(`/jam/rooms/${response.room.id}`, { replace: true });
      })
      .catch(() => {
        if (cancelled) return;
        toast.error(t("jamInvite.toasts.invalid"));
        navigate("/jam", { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, t, token]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <Loader2 size={22} className="animate-spin text-accent-action" />
      <div>
        <p className="text-lg font-medium text-text-primary">
          {t("jamInvite.title")}
        </p>
        <p className="text-sm text-text-muted">{t("jamInvite.subtitle")}</p>
      </div>
    </div>
  );
}
