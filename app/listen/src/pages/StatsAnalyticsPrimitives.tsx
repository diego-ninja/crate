export function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-dark-card rounded-lg px-4 py-3">
      <div className="stats-muted-label text-xs font-black uppercase tracking-[0.18em]">
        {label}
      </div>
      <div className="mt-1 text-lg font-black text-text-primary">{value}</div>
    </div>
  );
}
