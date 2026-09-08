import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { api, ApiError } from "@/lib/api";

export function useArtistSuggestionController() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [artist, setArtist] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const artistName = artist.trim();
  const error =
    artistName.length > 0 && artistName.length < 2
      ? t("userMenu.suggest.validation.minChars")
      : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (artistName.length < 2) return;
    setSending(true);
    try {
      await api("/api/me/artist-suggestions", "POST", {
        artist_name: artistName,
        artist_url: url.trim() || undefined,
        note: note.trim() || undefined,
      });
      toast.success(t("userMenu.suggest.toasts.sent"));
      setArtist("");
      setUrl("");
      setNote("");
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("userMenu.suggest.toasts.failed"),
      );
    } finally {
      setSending(false);
    }
  }

  return {
    open,
    artist,
    url,
    note,
    sending,
    artistName,
    error,
    openModal: () => setOpen(true),
    closeModal: () => setOpen(false),
    setArtist,
    setUrl,
    setNote,
    submit,
  };
}
