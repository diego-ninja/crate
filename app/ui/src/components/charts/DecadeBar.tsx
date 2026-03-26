import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface DecadeBarProps {
  data: Record<string, number>;
}

export function DecadeBar({ data }: DecadeBarProps) {
  const entries = Object.entries(data).map(([name, value]) => ({
    name,
    value,
  }));

  if (!entries.length) return <div className="text-muted-foreground text-sm">No data</div>;

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={entries}>
        <XAxis dataKey="name" tick={{ fill: "#7b88a1", fontSize: 12 }} />
        <YAxis tick={{ fill: "#7b88a1", fontSize: 12 }} />
        <Tooltip
          contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }}
        />
        <Bar dataKey="value" fill="#22c55e" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
