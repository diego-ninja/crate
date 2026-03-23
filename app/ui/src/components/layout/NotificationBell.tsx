import { useState, useRef, useEffect } from "react";
import { useNotificationCenter } from "@/contexts/NotificationContext";
import { Bell, CheckCircle2, XCircle, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllRead, clearAll } = useNotificationCenter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(!open); if (!open) markAllRead(); }}
        className="relative p-2 rounded-md hover:bg-accent transition-colors"
      >
        <Bell size={18} className="text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary text-[10px] text-primary-foreground rounded-full flex items-center justify-center font-bold">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-sm font-semibold">Notifications</span>
            <div className="flex gap-1">
              {notifications.length > 0 && (
                <>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={markAllRead} title="Mark all read">
                    <Check size={12} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={clearAll} title="Clear all">
                    <Trash2 size={12} />
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No notifications</div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  className={`w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors border-b border-border last:border-0 ${!n.read ? "bg-accent/20" : ""}`}
                  onClick={() => { markAsRead(n.id); }}
                >
                  {n.status === "completed" ? (
                    <CheckCircle2 size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
                  ) : (
                    <XCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm capitalize">{n.type.replace(/_/g, " ")}</div>
                    <div className="text-[11px] text-muted-foreground">{timeAgo(n.timestamp)}</div>
                  </div>
                </button>
              ))
            )}
          </div>
          {notifications.length > 0 && (
            <button
              className="w-full py-2 text-xs text-center text-muted-foreground hover:text-foreground border-t border-border"
              onClick={() => { navigate("/tasks"); setOpen(false); }}
            >
              View All Tasks
            </button>
          )}
        </div>
      )}
    </div>
  );
}
