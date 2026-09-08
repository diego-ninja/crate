import { Loader2 } from "@crate/ui/icons";

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={24} className="text-accent-action animate-spin" />
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <p className="text-sm text-text-muted">{message}</p>
    </div>
  );
}

export function StatBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1 rounded-lg bg-text-primary/5 px-3 py-2.5 text-center">
      <div className="text-lg font-bold text-text-primary">{value ?? 0}</div>
      <div className="text-xs text-text-muted">{label}</div>
    </div>
  );
}
