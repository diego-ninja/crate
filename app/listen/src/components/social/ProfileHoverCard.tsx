import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { api } from "@/lib/api";
import {
  ErrorCard,
  LoadingCard,
  ProfileCardBody,
  type ProfileCardPayload,
} from "./ProfileHoverCardContent";

interface ProfileHoverCardProps {
  username?: string | null;
  children: ReactNode;
  className?: string;
  openDelayMs?: number;
}

const profileCardCache = new Map<string, ProfileCardPayload>();

export function clearProfileCardCacheForTests() {
  profileCardCache.clear();
}

function cacheProfileCard(username: string, card: ProfileCardPayload) {
  profileCardCache.set(username, card);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function ProfileHoverCard({
  username,
  children,
  className,
  openDelayMs = 180,
}: ProfileHoverCardProps) {
  const isDesktop = useIsDesktop();
  const normalizedUsername = username?.trim().replace(/^@/, "") || "";
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const activeRequestRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const [card, setCard] = useState<ProfileCardPayload | null>(
    normalizedUsername
      ? profileCardCache.get(normalizedUsername) || null
      : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!normalizedUsername) return;
    requestIdRef.current += 1;
    activeRequestRef.current = null;
    setCard(profileCardCache.get(normalizedUsername) || null);
    setLoading(false);
    setError(false);
  }, [normalizedUsername]);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      activeRequestRef.current = null;
      if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open || !isDesktop || !normalizedUsername || card) return;

    const cachedCard = profileCardCache.get(normalizedUsername);
    if (cachedCard) {
      setCard(cachedCard);
      setLoading(false);
      setError(false);
      return;
    }

    if (activeRequestRef.current === normalizedUsername) return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    activeRequestRef.current = normalizedUsername;
    setLoading(true);
    setError(false);
    api<ProfileCardPayload>(
      `/api/users/${encodeURIComponent(normalizedUsername)}/card`,
    )
      .then((payload) => {
        if (requestIdRef.current !== requestId) return;
        cacheProfileCard(normalizedUsername, payload);
        setCard(payload);
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setError(true);
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        activeRequestRef.current = null;
        setLoading(false);
      });
  }, [card, isDesktop, normalizedUsername, open]);

  function updatePosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 360;
    const left = clamp(
      rect.left + rect.width / 2 - width / 2,
      12,
      window.innerWidth - width - 12,
    );
    const top =
      rect.bottom + 14 + 260 > window.innerHeight
        ? Math.max(12, rect.top - 286)
        : rect.bottom + 14;
    setPosition({ left, top });
  }

  function cancelClose() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function scheduleOpen() {
    if (!isDesktop || !normalizedUsername) return;
    cancelClose();
    if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
    openTimerRef.current = window.setTimeout(() => {
      updatePosition();
      setOpen(true);
    }, openDelayMs);
  }

  function scheduleClose() {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }

  async function handleFollowToggle() {
    if (!card) return;
    setBusy(true);
    try {
      if (card.relationship_state.following) {
        await api(`/api/users/${card.id}/follow`, "DELETE");
        const nextCard = {
          ...card,
          relationship_state: {
            ...card.relationship_state,
            following: false,
            is_friend: false,
          },
        };
        cacheProfileCard(normalizedUsername, nextCard);
        setCard(nextCard);
      } else {
        const response = await api<{
          relationship_state?: ProfileCardPayload["relationship_state"];
        }>(`/api/users/${card.id}/follow`, "POST");
        const nextCard = {
          ...card,
          relationship_state: response.relationship_state || {
            ...card.relationship_state,
            following: true,
          },
        };
        cacheProfileCard(normalizedUsername, nextCard);
        setCard(nextCard);
      }
    } finally {
      setBusy(false);
    }
  }

  const trigger = (
    <span
      ref={triggerRef}
      className={className}
      onPointerEnter={scheduleOpen}
      onPointerLeave={scheduleClose}
      onFocus={scheduleOpen}
      onBlur={scheduleClose}
    >
      {children}
    </span>
  );

  if (!isDesktop || !normalizedUsername) return trigger;

  return (
    <>
      {trigger}
      {open
        ? createPortal(
            <AppPopover
              layer="popover"
              className="profile-hover-popover fixed w-[360px] overflow-visible p-0"
              style={{ left: position.left, top: position.top }}
              onPointerEnter={cancelClose}
              onPointerLeave={scheduleClose}
            >
              {loading ? (
                <LoadingCard />
              ) : error ? (
                <ErrorCard />
              ) : card ? (
                <ProfileCardBody
                  card={card}
                  busy={busy}
                  onFollowToggle={() => void handleFollowToggle()}
                />
              ) : null}
            </AppPopover>,
            document.body,
          )
        : null}
    </>
  );
}
