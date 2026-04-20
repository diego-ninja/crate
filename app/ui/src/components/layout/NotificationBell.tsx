import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import { Bell, CheckCircle2, XCircle, Check, Trash2 } from "lucide-react";

import { AppPopover } from "@/components/ui/AppPopover";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { useNotificationCenter } from "@/contexts/NotificationContext";
import { timeAgo } from "@/lib/utils";

export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllRead, clearAll } = useNotificationCenter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) markAllRead();
        }}
        className="relative flex h-11 w-11 items-center justify-center rounded-md border border-white/10 bg-black/30 text-white/60 shadow-[0_6px_20px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white"
        aria-label="Notifications"
      >
        <Bell size={17} />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-md bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <AppPopover className="absolute right-0 top-full mt-2 w-80 overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-white/6 px-4 py-3">
            <span className="text-sm font-semibold text-white">Notifications</span>
            {notifications.length > 0 ? (
              <div className="flex items-center gap-1">
                <ActionIconButton variant="row" className="h-8 w-8" onClick={markAllRead} title="Mark all read">
                  <Check size={13} />
                </ActionIconButton>
                <ActionIconButton variant="row" className="h-8 w-8" onClick={clearAll} title="Clear all">
                  <Trash2 size={13} />
                </ActionIconButton>
              </div>
            ) : null}
          </div>

          <div className="max-h-[320px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-10 text-center text-sm text-white/40">No notifications</div>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  className={`flex w-full items-start gap-3 border-b border-white/5 px-4 py-3 text-left transition-colors last:border-0 ${
                    !notification.read ? "bg-white/[0.04]" : "hover:bg-white/5"
                  }`}
                  onClick={() => {
                    markAsRead(notification.id);
                  }}
                >
                  {notification.status === "completed" ? (
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-green-400" />
                  ) : (
                    <XCircle size={15} className="mt-0.5 shrink-0 text-red-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm capitalize text-white/85">
                      {notification.type.replace(/_/g, " ")}
                    </div>
                    <div className="mt-1 text-[11px] text-white/35">{timeAgo(notification.timestamp)}</div>
                  </div>
                </button>
              ))
            )}
          </div>

          {notifications.length > 0 ? (
            <button
              type="button"
              className="w-full border-t border-white/6 py-2.5 text-center text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white"
              onClick={() => {
                navigate("/tasks");
                setOpen(false);
              }}
            >
              View all tasks
            </button>
          ) : null}
        </AppPopover>
      ) : null}
    </div>
  );
}
