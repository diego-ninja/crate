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
        <XAxis dataKey="name" tick={{ fill: "#737373", fontSize: 12 }} />
        <YAxis tick={{ fill: "#737373", fontSize: 12 }} />
        <Tooltip
          contentStyle={{ background: "#141414", border: "1px solid #262626", borderRadius: 8 }}
        />
        <Bar dataKey="value" fill="#22c55e" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
