import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

import { sendRadioFeedback } from "@/lib/radio";

interface RadioFeedbackProps {
  sessionId: string;
  trackId: number | undefined;
}

export function RadioFeedback({ sessionId, trackId }: RadioFeedbackProps) {
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);

  if (!trackId) return null;

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
    await sendRadioFeedback(sessionId, trackId, "dislike");
    toast("Less like this", { duration: 1500 });
  };

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handleLike}
        className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
          liked
            ? "bg-primary/15 text-primary"
            : "text-white/30 hover:bg-white/5 hover:text-white/60"
        }`}
        title="More like this"
      >
        <ThumbsUp size={14} className={liked ? "fill-current" : ""} />
      </button>
      <button
        onClick={handleDislike}
        className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
          disliked
            ? "bg-red-500/15 text-red-400"
            : "text-white/30 hover:bg-white/5 hover:text-white/60"
        }`}
        title="Less like this"
      >
        <ThumbsDown size={14} className={disliked ? "fill-current" : ""} />
      </button>
    </div>
  );
}
