import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from "react";

import { Heart, HeartBold } from "../icons/media";
import { cn } from "../lib/cn";

type FollowAnimation = "follow" | "unfollow" | null;
const FOLLOW_ANIMATION_CLEANUP_MS = 1400;

interface FollowParticle {
  heartX: string;
  heartY: string;
  orbitX: string;
  orbitY: string;
  delay: string;
  size: string;
  midX?: string;
  midY?: string;
  duration?: string;
}

const FOLLOW_PARTICLES: FollowParticle[] = [
  {
    heartX: "-6px",
    heartY: "-6px",
    orbitX: "-16px",
    orbitY: "-12px",
    delay: "0ms",
    size: "3px",
  },
  {
    heartX: "0px",
    heartY: "-7px",
    orbitX: "0px",
    orbitY: "-19px",
    delay: "35ms",
    size: "2px",
  },
  {
    heartX: "6px",
    heartY: "-6px",
    orbitX: "16px",
    orbitY: "-12px",
    delay: "70ms",
    size: "3px",
  },
  {
    heartX: "-9px",
    heartY: "-2px",
    orbitX: "-20px",
    orbitY: "-2px",
    delay: "105ms",
    size: "2px",
  },
  {
    heartX: "9px",
    heartY: "-2px",
    orbitX: "20px",
    orbitY: "-2px",
    delay: "140ms",
    size: "2px",
  },
  {
    heartX: "-7px",
    heartY: "3px",
    orbitX: "-16px",
    orbitY: "9px",
    delay: "175ms",
    size: "3px",
  },
  {
    heartX: "7px",
    heartY: "3px",
    orbitX: "16px",
    orbitY: "9px",
    delay: "210ms",
    size: "3px",
  },
  {
    heartX: "-3px",
    heartY: "7px",
    orbitX: "-8px",
    orbitY: "18px",
    delay: "245ms",
    size: "2px",
  },
  {
    heartX: "3px",
    heartY: "7px",
    orbitX: "8px",
    orbitY: "18px",
    delay: "280ms",
    size: "2px",
  },
  {
    heartX: "0px",
    heartY: "10px",
    orbitX: "0px",
    orbitY: "23px",
    delay: "315ms",
    size: "3px",
  },
];

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomizePixel(value: string, spread: number) {
  const pixels = Number.parseFloat(value);
  return `${Math.round(pixels + randomBetween(-spread, spread))}px`;
}

function randomizeMilliseconds(value: string, spread: number) {
  const milliseconds = Number.parseFloat(value);
  return `${Math.max(
    0,
    Math.round(milliseconds + randomBetween(-spread, spread)),
  )}ms`;
}

function randomizeSize(value: string) {
  const pixels = Number.parseFloat(value);
  return `${Math.max(
    1.5,
    Math.min(3.5, pixels + randomBetween(-0.7, 0.7)),
  ).toFixed(1)}px`;
}

function createFollowParticles() {
  return FOLLOW_PARTICLES.map((particle) => {
    const orbitX = randomizePixel(particle.orbitX, 12);
    const orbitY = randomizePixel(particle.orbitY, 8);
    const heartX = randomizePixel(particle.heartX, 4);
    const heartY = randomizePixel(particle.heartY, 4);

    return {
      ...particle,
      orbitX,
      orbitY,
      heartX,
      heartY,
      midX: `${Math.round(
        Number.parseFloat(orbitX) * 0.65 + randomBetween(-5, 5),
      )}px`,
      midY: `${Math.round(
        Number.parseFloat(orbitY) * 0.65 + randomBetween(-5, 5),
      )}px`,
      delay: randomizeMilliseconds(particle.delay, 45),
      size: randomizeSize(particle.size),
      duration: `${Math.round(randomBetween(680, 920))}ms`,
    };
  });
}

interface FollowHeartButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  following: boolean;
  iconSize?: number | string;
  children?: ReactNode;
  heartTestId?: string;
  particlesTestId?: string;
}

export function FollowHeartButton({
  following,
  iconSize = 18,
  children,
  className,
  heartTestId,
  particlesTestId,
  onClick,
  type = "button",
  ...props
}: FollowHeartButtonProps) {
  const [followAnimation, setFollowAnimation] = useState<FollowAnimation>(null);
  const [followAnimationId, setFollowAnimationId] = useState(0);
  const [followParticles, setFollowParticles] =
    useState<FollowParticle[]>(FOLLOW_PARTICLES);

  useEffect(() => {
    if (!followAnimation) return;
    const timeout = window.setTimeout(
      () => setFollowAnimation(null),
      FOLLOW_ANIMATION_CLEANUP_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [followAnimation, followAnimationId]);

  const isAnimating = followAnimation !== null;
  const isActive = following || isAnimating;

  const handleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    const nextAnimation = following ? "unfollow" : "follow";
    if (nextAnimation === "follow") {
      setFollowParticles(createFollowParticles());
    }
    setFollowAnimation(nextAnimation);
    setFollowAnimationId((current) => current + 1);
    onClick?.(event);
  };

  return (
    <button
      {...props}
      type={type}
      aria-pressed={following}
      className={cn(
        "relative inline-flex items-center justify-center gap-1.5 transition-[color,filter,transform]",
        className,
        isActive
          ? "text-accent-action drop-shadow-accent-action"
          : "text-text-primary/80",
      )}
      onClick={handleClick}
    >
      <span
        className="relative inline-flex shrink-0 items-center justify-center"
        style={{ width: iconSize, height: iconSize }}
      >
        {followAnimation ? (
          <span
            key={`${followAnimation}-${followAnimationId}`}
            data-testid={particlesTestId}
            aria-hidden="true"
            className={cn(
              "crate-follow-particles",
              followAnimation === "unfollow"
                ? "crate-follow-particles--unfollow"
                : "",
            )}
          >
            {(followAnimation === "follow"
              ? followParticles
              : FOLLOW_PARTICLES
            ).map((particle, index) => {
              const midX =
                particle.midX ??
                `${Math.round(Number.parseFloat(particle.orbitX) * 0.65)}px`;
              const midY =
                particle.midY ??
                `${Math.round(Number.parseFloat(particle.orbitY) * 0.65)}px`;
              const style = {
                "--follow-particle-size": particle.size,
                "--follow-particle-delay": particle.delay,
                "--follow-particle-duration": particle.duration ?? "760ms",
                "--follow-particle-mid-x": midX,
                "--follow-particle-mid-y": midY,
                "--follow-particle-start-x":
                  followAnimation === "follow"
                    ? particle.orbitX
                    : particle.heartX,
                "--follow-particle-start-y":
                  followAnimation === "follow"
                    ? particle.orbitY
                    : particle.heartY,
                "--follow-particle-end-x":
                  followAnimation === "follow"
                    ? particle.heartX
                    : particle.orbitX,
                "--follow-particle-end-y":
                  followAnimation === "follow"
                    ? particle.heartY
                    : particle.orbitY,
              } as CSSProperties;

              return (
                <span
                  key={index}
                  className="crate-follow-particle"
                  style={style}
                />
              );
            })}
          </span>
        ) : null}
        {isActive ? (
          <HeartBold
            data-testid={heartTestId}
            size={iconSize}
            className={cn(
              "text-accent-action animate-crate-icon-active-pulse",
              followAnimation === "follow"
                ? "crate-follow-heart-in"
                : followAnimation === "unfollow"
                  ? "crate-follow-heart-out"
                  : "",
            )}
          />
        ) : (
          <Heart data-testid={heartTestId} size={iconSize} />
        )}
      </span>
      {children}
    </button>
  );
}
