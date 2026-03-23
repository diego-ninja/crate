import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { api } from "@/lib/api";

interface Notification {
  id: string;
  type: string;
  status: "completed" | "failed";
  timestamp: string;
  message?: string;
  read: boolean;
}

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotificationCenter() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotificationCenter must be inside NotificationProvider");
  return ctx;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [seenIds] = useState(() => new Set<string>());

  // Poll for completed/failed tasks every 5s
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const data = await api<{ recent_tasks: { id: string; type: string; status: string; updated_at: string }[] }>("/api/activity/live");
        const completed = data.recent_tasks.filter(t => t.status === "completed" || t.status === "failed");
        for (const task of completed) {
          if (!seenIds.has(task.id)) {
            seenIds.add(task.id);
            setNotifications(prev => [{
              id: task.id,
              type: task.type,
              status: task.status as "completed" | "failed",
              timestamp: task.updated_at,
              message: `${task.type.replace(/_/g, " ")} ${task.status}`,
              read: false,
            }, ...prev].slice(0, 20));
          }
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(poll);
  }, [seenIds]);

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAsRead, markAllRead, clearAll }}>
      {children}
    </NotificationContext.Provider>
  );
}
