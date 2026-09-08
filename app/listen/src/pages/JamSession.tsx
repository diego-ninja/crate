import { Link } from "react-router";
import { Loader2 } from "@crate/ui/icons";

import { JamLobbyView } from "@/components/jam/JamLobbyView";
import { JamRoomView } from "@/components/jam/JamRoomView";
import { useJamSessionController } from "@/hooks/use-jam-session-controller";
export function JamSession() {
  const { t, roomId, loading, error, room, lobbyViewProps, roomViewProps } =
    useJamSessionController();

  if (!roomId) {
    return <JamLobbyView {...lobbyViewProps} />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={22} className="animate-spin text-accent-action" />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-lg font-medium text-text-primary">
          {t("jam.room.unavailableTitle")}
        </p>
        <p className="max-w-md text-sm text-text-muted">
          {error || t("jam.room.unavailableDescription")}
        </p>
        <Link
          to="/jam"
          className="jam-secondary-action inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-text-primary transition-colors"
        >
          {t("jam.room.backToJam")}
        </Link>
      </div>
    );
  }

  return <JamRoomView {...roomViewProps} />;
}
