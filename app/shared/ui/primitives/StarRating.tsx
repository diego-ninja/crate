import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@crate/ui/lib/cn";

interface StarRatingProps {
  value: number;
  onChange?: (rating: number) => void;
  size?: number;
  readonly?: boolean;
}

export function StarRating({ value, onChange, size = 14, readonly = false }: StarRatingProps) {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= (hover || value);
        return (
          <button
            key={star}
            type="button"
            disabled={readonly}
            className={cn(
              "transition-colors",
              readonly ? "cursor-default" : "cursor-pointer hover:scale-110",
              filled ? "text-primary" : "text-muted-foreground/20"
            )}
            onMouseEnter={() => !readonly && setHover(star)}
            onMouseLeave={() => setHover(0)}
            onClick={(e) => {
              e.stopPropagation();
              if (readonly) return;
              onChange?.(star === value ? 0 : star);
            }}
          >
            <Star size={size} className={filled ? "fill-current" : ""} />
          </button>
        );
      })}
    </div>
  );
}
