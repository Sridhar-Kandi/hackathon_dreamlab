import { useMemo, useState } from "react"
import { GroupedBars, SERIES } from "@/components/charts"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CATEGORIES, configRows, SLOT_LETTERS, summarize, type SaveFile } from "@/lib/analysis"
import { number, percent, usd } from "@/lib/format"
import { cn } from "@/lib/utils"

export function RunHeading({ file, index }: { file: SaveFile; index: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2.5 rounded-[2px]" style={{ background: SERIES[index] }} aria-hidden />
      <span className="font-semibold text-foreground">{SLOT_LETTERS[index]}</span>
      <span className="max-w-52 truncate font-normal text-foreground" title={file.name}>{file.name}</span>
    </span>
  )
}

export function ConfigDiff({ files }: { files: SaveFile[] }) {
  const [onlyDiff, setOnlyDiff] = useState(true)
  const rows = useMemo(() => configRows(files), [files])
  const shown = onlyDiff ? rows.filter((r) => r.differs) : rows
  const differing = rows.filter((r) => r.differs).length
  let lastGroup = ""
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-[0.8125rem] text-muted-foreground">
        <span>{differing} of {rows.length} settings differ between the selected runs.</span>
        <label className="flex items-center gap-2">
          <Switch checked={onlyDiff} onCheckedChange={setOnlyDiff} /> Only differences
        </label>
      </div>
      <div className="max-h-[420px] overflow-auto rounded-sm border">
        <Table className="text-[0.8125rem]">
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 w-56 px-3 text-[0.8125rem] font-semibold text-muted-foreground">Setting</TableHead>
              {files.map((f, i) => (
                <TableHead key={f.id} className="h-8 px-3 text-[0.8125rem]"><RunHeading file={f} index={i} /></TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => {
              const groupRow = row.group !== lastGroup
              lastGroup = row.group
              return [
                groupRow && (
                  <TableRow key={`${row.group}-heading`} className="bg-muted hover:bg-muted">
                    <TableCell colSpan={files.length + 1} className="px-3 py-1 text-[0.75rem] font-semibold tracking-wide text-muted-foreground uppercase">{row.group}</TableCell>
                  </TableRow>
                ),
                <TableRow key={`${row.group}-${row.label}`} className={cn(row.differs && "bg-warning-bg hover:bg-warning-bg")}>
                  <TableCell className="px-3 py-1.5 text-foreground">
                    {row.label}
                    {row.differs && <span className="ml-1.5 rounded-sm border border-warning-border px-1 text-[0.6875rem] text-warning">differs</span>}
                  </TableCell>
                  {row.values.map((v, i) => (
                    <TableCell key={i} className="max-w-64 truncate px-3 py-1.5 font-mono text-[0.75rem]" title={v}>{v}</TableCell>
                  ))}
                </TableRow>,
              ]
            })}
            {!shown.length && (
              <TableRow><TableCell colSpan={files.length + 1} className="py-6 text-center text-muted-foreground">The selected runs use identical settings.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export function PerformanceComparison({ files }: { files: SaveFile[] }) {
  const stats = useMemo(() => files.map(summarize), [files])
  const metrics: { label: string; render: (s: ReturnType<typeof summarize>) => string; best?: "high" | "low"; value?: (s: ReturnType<typeof summarize>) => number | null }[] = [
    { label: "Success rate (graded)", render: (s) => percent(s.successRate), best: "high", value: (s) => s.successRate },
    { label: "95% confidence interval", render: (s) => (s.ci ? `${percent(s.ci[0])} – ${percent(s.ci[1])}` : "—") },
    { label: "Successes / graded trials", render: (s) => `${s.successes} / ${s.graded}` },
    { label: "Trial efficiency (successes per trial run)", render: (s) => percent(s.efficiency), best: "high", value: (s) => s.efficiency },
    { label: "Infrastructure errors", render: (s) => String(s.errors), best: "low", value: (s) => s.errors },
    { label: "Mean time to success (sim)", render: (s) => number(s.timeToSuccess, 1, " s"), best: "low", value: (s) => s.timeToSuccess },
    { label: "Mean simulated time per trial", render: (s) => number(s.simTime, 1, " s") },
    { label: "Mean model calls per trial", render: (s) => number(s.calls, 0) },
    { label: "Mean wall-clock time per trial", render: (s) => number(s.wall, 0, " s"), best: "low", value: (s) => s.wall },
    { label: "Harness interventions per trial", render: (s) => number(s.interventionsPerTrial, 2) },
    { label: "API cost (estimated)", render: (s) => usd(s.cost), best: "low", value: (s) => s.cost },
  ]

  const rateData = [{ label: "Success rate", ...Object.fromEntries(stats.map((s, i) => [`r${i}`, s.successRate])) }]
  const categoryData = CATEGORIES.map((category) => ({
    label: category,
    ...Object.fromEntries(stats.map((s, i) => [`r${i}`, s.trials ? (s.categories[category] ?? 0) / s.trials : 0])),
  }))
  const series = files.map((f, i) => ({ key: `r${i}`, name: `${SLOT_LETTERS[i]} · ${f.name}` }))
  const liftBuckets = ["0", "0–5", "5–10", "10–15", "15+"]
  const bucket = (cm: number) => (cm <= 0 ? 0 : cm < 5 ? 1 : cm < 10 ? 2 : cm < 15 ? 3 : 4)
  const liftData = liftBuckets.map((label, b) => ({
    label: `${label} cm`,
    ...Object.fromEntries(stats.map((s, i) => [`r${i}`, s.lifts.length ? s.lifts.filter((cm) => bucket(cm) === b).length / s.lifts.length : 0])),
  }))

  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto rounded-sm border">
        <Table className="text-[0.875rem]">
          <TableHeader className="bg-background">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 w-72 px-3 text-[0.8125rem] font-semibold text-muted-foreground">Metric</TableHead>
              {files.map((f, i) => <TableHead key={f.id} className="h-8 px-3 text-[0.8125rem]"><RunHeading file={f} index={i} /></TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {metrics.map((m) => {
              const values = m.value ? stats.map(m.value) : []
              const valid = values.filter((v): v is number => v !== null)
              const target = valid.length > 1 ? (m.best === "high" ? Math.max(...valid) : Math.min(...valid)) : null
              return (
                <TableRow key={m.label}>
                  <TableCell className="px-3 py-1.5 text-foreground">{m.label}</TableCell>
                  {stats.map((s, i) => (
                    <TableCell key={i} className={cn("px-3 py-1.5 tabular-nums", target !== null && values[i] === target && "font-semibold text-success")}>
                      {m.render(s)}{target !== null && values[i] === target ? " ★" : ""}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-[0.75rem] text-muted-foreground">★ best value among the selected runs. Success rate excludes infrastructure errors; efficiency counts them.</p>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-sm border p-3">
          <h3 className="mb-1 text-[0.875rem] font-semibold">Success rate</h3>
          <GroupedBars data={rateData} series={series} percent height={220} />
        </div>
        <div className="rounded-sm border p-3">
          <h3 className="mb-1 text-[0.875rem] font-semibold">Failure categories (share of trials)</h3>
          <GroupedBars data={categoryData} series={series} percent height={220} />
        </div>
        <div className="rounded-sm border p-3">
          <h3 className="mb-1 text-[0.875rem] font-semibold">Max lift distribution (share of graded trials)</h3>
          <GroupedBars data={liftData} series={series} percent height={220} />
        </div>
      </div>
    </div>
  )
}
