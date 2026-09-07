import { Globe2, Lock } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";

import type { JamQueueMode } from "@/pages/jam-reducer";

import type { JamRoomCreatePanelProps } from "./jam-lobby-types";

export function PlaybackModeSelect({
  roomQueueMode,
  onRoomQueueModeChange,
  setRoomPermanent,
}: Pick<
  JamRoomCreatePanelProps,
  "roomQueueMode" | "onRoomQueueModeChange" | "setRoomPermanent"
>) {
  const { t } = useTranslation();

  return (
    <label className="flex flex-col gap-2 text-sm text-text-primary">
      <span className="text-xs uppercase tracking-wide text-text-muted">
        {t("jam.lobby.playbackMode")}
      </span>
      <Select
        value={roomQueueMode}
        onValueChange={(value) => {
          const nextMode = value as JamQueueMode;
          onRoomQueueModeChange(nextMode);
          if (nextMode === "auto_dj") setRoomPermanent(true);
        }}
      >
        <SelectTrigger
          aria-label={t("jam.lobby.playbackMode")}
          className="jam-select-trigger h-11 w-full px-4"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="manual">{t("jam.room.djMode")}</SelectItem>
          <SelectItem value="auto">{t("jam.room.autoMode")}</SelectItem>
          <SelectItem value="auto_dj">{t("jam.room.autoDjMode")}</SelectItem>
        </SelectContent>
      </Select>
    </label>
  );
}

export function RoomVisibilityOptions({
  roomVisibility,
  setRoomVisibility,
}: Pick<JamRoomCreatePanelProps, "roomVisibility" | "setRoomVisibility">) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <button
        type="button"
        onClick={() => setRoomVisibility("private")}
        className={`jam-toggle-option flex items-center gap-2 rounded-lg p-3 text-left text-sm transition-colors ${
          roomVisibility === "private" ? "" : "text-text-muted"
        }`}
        data-active={roomVisibility === "private" ? "true" : "false"}
      >
        <Lock size={15} />
        {t("jam.visibility.inviteOnly")}
      </button>
      <button
        type="button"
        onClick={() => setRoomVisibility("public")}
        className={`jam-toggle-option flex items-center gap-2 rounded-lg p-3 text-left text-sm transition-colors ${
          roomVisibility === "public" ? "" : "text-text-muted"
        }`}
        data-active={roomVisibility === "public" ? "true" : "false"}
      >
        <Globe2 size={15} />
        {t("jam.visibility.public")}
      </button>
    </div>
  );
}
