import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const COLORS: Record<string, string> = {
  flac: "#22c55e",
  mp3: "#3b82f6",
  m4a: "#f97316",
  ogg: "#88c0d0",
  opus: "#eab308",
};

interface FormatDonutProps {
  data: Record<string, number>;
}

export function FormatDonut({ data }: FormatDonutProps) {
  const entries = Object.entries(data).map(([name, value]) => ({
    name: name.replace(".", "").toUpperCase(),
    value,
    key: name.replace(".", "").toLowerCase(),
  }));

  if (!entries.length) return <div className="text-muted-foreground text-sm">No data</div>;

  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie
          data={entries}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          dataKey="value"
          nameKey="name"
          paddingAngle={2}
        >
          {entries.map((entry) => (
            <Cell
              key={entry.key}
              fill={COLORS[entry.key] || "#88c0d0"}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: "#3b4252", border: "1px solid #4c566a", borderRadius: 8 }}
          labelStyle={{ color: "#eceff4" }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
