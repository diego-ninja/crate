import { useEffect, useState } from "react";
import { ThumbsDown, ThumbsUp } from "@crate/ui/icons";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { sendRadioFeedback } from "@/lib/radio";

interface RadioFeedbackProps {
  sessionId: string;
  trackId: number | undefined;
  globalTrackUid?: string;
  onDislike?: () => void;
  size?: "sm" | "md";
}

export function RadioFeedback({
  sessionId,
  trackId,
  globalTrackUid,
  onDislike,
  size = "md",
}: RadioFeedbackProps) {
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    setLiked(false);
    setDisliked(false);
  }, [sessionId, trackId, globalTrackUid]);

  if (!trackId && !globalTrackUid) return null;

  const buttonClass = size === "sm" ? "h-11 w-11" : "h-8 w-8";
  const iconSize = size === "sm" ? 16 : 14;

  const handleLike = async () => {
    if (liked) return;
    setLiked(true);
    setDisliked(false);
    await (globalTrackUid
      ? sendRadioFeedback(sessionId, trackId, "like", globalTrackUid)
      : sendRadioFeedback(sessionId, trackId, "like"));
    toast.success(t("player.radio.moreLikeThis"), { duration: 1500 });
  };

  const handleDislike = async () => {
    if (disliked) return;
    setDisliked(true);
    setLiked(false);
    void (globalTrackUid
      ? sendRadioFeedback(sessionId, trackId, "dislike", globalTrackUid)
      : sendRadioFeedback(sessionId, trackId, "dislike"));
    onDislike?.();
    toast(t("player.radio.lessLikeThis"), { duration: 1500 });
  };

  return (
    <div className="flex items-center gap-1">
      {trackId || globalTrackUid ? (
        <button
          onClick={handleLike}
          className={`flex ${buttonClass} touch-manipulation items-center justify-center rounded-full transition ${
            liked
              ? "bg-accent-action/15 text-accent-action"
              : "text-text-primary/30 hover:bg-text-primary/5 hover:text-text-primary/60"
          }`}
          title={t("player.radio.moreLikeThis")}
          aria-label={t("player.radio.moreLikeThis")}
        >
          <ThumbsUp size={iconSize} className={liked ? "fill-current" : ""} />
        </button>
      ) : null}
      <button
        onClick={handleDislike}
        className={`flex ${buttonClass} touch-manipulation items-center justify-center rounded-full transition ${
          disliked
            ? "bg-state-danger/15 text-state-danger"
            : "text-text-primary/30 hover:bg-text-primary/5 hover:text-text-primary/60"
        }`}
        title={t("player.radio.lessLikeThis")}
        aria-label={t("player.radio.lessLikeThis")}
      >
        <ThumbsDown
          size={iconSize}
          className={disliked ? "fill-current" : ""}
        />
      </button>
    </div>
  );
}
