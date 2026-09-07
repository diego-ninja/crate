import { Users } from "@crate/ui/icons";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { extractInviteToken } from "@/pages/jam-session-utils";

export function JamInvitePanel({
  inviteInput,
  setInviteInput,
}: {
  inviteInput: string;
  setInviteInput: (value: string) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <section className="jam-panel rounded-[12px] p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-text-primary">
        {t("jam.lobby.joinInviteTitle")}
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        {t("jam.lobby.joinInviteSubtitle")}
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          value={inviteInput}
          onChange={(event) => setInviteInput(event.target.value)}
          placeholder={t("jam.lobby.invitePlaceholder")}
          className="jam-input h-11 min-w-0 flex-1 rounded-lg px-4 text-base text-text-primary"
        />
        <button
          type="button"
          onClick={() => {
            const token = extractInviteToken(inviteInput);
            if (!token) {
              toast.error(t("jam.toasts.invalidInvite"));
              return;
            }
            navigate(`/jam/invite/${token}`);
          }}
          className="jam-secondary-action inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-text-primary transition-colors"
        >
          <Users size={15} />
          {t("jam.lobby.joinRoom")}
        </button>
      </div>
    </section>
  );
}
