import { useEffect, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

import { sendRadioFeedback } from "@/lib/radio";

interface RadioFeedbackProps {
  sessionId: string;
  trackId: number | undefined;
  onDislike?: () => void;
  size?: "sm" | "md";
}

export function RadioFeedback({ sessionId, trackId, onDislike, size = "md" }: RadioFeedbackProps) {
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);

  useEffect(() => {
    setLiked(false);
    setDisliked(false);
  }, [sessionId, trackId]);

  if (!trackId) return null;

  const buttonClass = size === "sm"
    ? "h-9 w-9"
    : "h-8 w-8";
  const iconSize = size === "sm" ? 16 : 14;

  const handleLike = async () => {
    if (liked) return;
    setLiked(true);
    setDisliked(false);
    await sendRadioFeedback(sessionId, trackId, "like");
    toast.success("More like this", { duration: 1500 });
  };

  const handleDislike = async () => {
    if (disliked) return;
    setDisliked(true);
    setLiked(false);
    void sendRadioFeedback(sessionId, trackId, "dislike");
    onDislike?.();
    toast("Less like this", { duration: 1500 });
  };

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handleLike}
        className={`flex ${buttonClass} items-center justify-center rounded-full transition ${
          liked
            ? "bg-primary/15 text-primary"
            : "text-white/30 hover:bg-white/5 hover:text-white/60"
        }`}
        title="More like this"
        aria-label="More like this"
      >
        <ThumbsUp size={iconSize} className={liked ? "fill-current" : ""} />
      </button>
      <button
        onClick={handleDislike}
        className={`flex ${buttonClass} items-center justify-center rounded-full transition ${
          disliked
            ? "bg-red-500/15 text-red-400"
            : "text-white/30 hover:bg-white/5 hover:text-white/60"
        }`}
        title="Less like this"
        aria-label="Less like this"
      >
        <ThumbsDown size={iconSize} className={disliked ? "fill-current" : ""} />
      </button>
    </div>
  );
}
