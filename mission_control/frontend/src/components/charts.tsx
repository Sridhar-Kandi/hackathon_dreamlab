import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"

// Categorical slots in fixed order (validated palette). Compared runs take slots 1-3 by their position.
export const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"]
const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" }
const GRID = "var(--border)"

const tooltipStyle = {
  contentStyle: { fontSize: 12, borderRadius: 12, borderColor: "var(--border)", backgroundColor: "var(--popover)", color: "var(--popover-foreground)", boxShadow: "0 8px 24px -12px rgba(28,28,28,.18)" },
  labelStyle: { color: "var(--foreground)", fontWeight: 600 },
  itemStyle: { color: "var(--foreground)" },
  cursor: { fill: "rgba(0,0,0,0.04)" },
}

// One measure across categories: horizontal bars, single series (the section title names it, so no legend).
export function HorizontalBars({ data, valueLabel, height }: {
  data: { label: string; value: number }[]; valueLabel: string; height?: number
}) {
  if (!data.length) return <p className="py-6 text-center text-[0.8125rem] text-muted-foreground">No data.</p>
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(120, data.length * 30 + 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 4 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={150} tick={AXIS} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipStyle} formatter={(value) => [value, valueLabel]} />
        <Bar dataKey="value" name={valueLabel} fill={SERIES[0]} barSize={14} radius={[0, 2, 2, 0]} isAnimationActive={false}
          label={{ position: "right", fontSize: 11, fill: "var(--foreground)" }} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// The same measure for up to three runs side by side: grouped bars with a legend.
export function GroupedBars({ data, series, unit = "", height = 240, percent = false }: {
  data: Record<string, string | number | null>[]
  series: { key: string; name: string }[]
  unit?: string
  height?: number
  percent?: boolean
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={AXIS} axisLine={{ stroke: "var(--input)" }} tickLine={false} interval={0} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40}
          tickFormatter={(v) => (percent ? `${Math.round(v * 100)}%` : `${v}${unit}`)}
          domain={percent ? [0, 1] : [0, "auto"]} />
        <Tooltip {...tooltipStyle}
          formatter={(value, name) => [value === null || value === undefined ? "—"
            : percent ? `${(Number(value) * 100).toFixed(0)}%` : `${value}${unit}`, name]} />
        {series.length > 1 && <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: "var(--foreground)" }} />}
        {series.map((s, index) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={SERIES[index % SERIES.length]} barSize={16} isAnimationActive={false}
            radius={[2, 2, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-sm border bg-card px-3 py-2.5">
      <p className="text-[0.8125rem] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[1.25rem] font-semibold text-foreground tabular-nums">{value}</p>
      {sub && <p className="text-[0.75rem] text-muted-foreground">{sub}</p>}
    </div>
  )
}
