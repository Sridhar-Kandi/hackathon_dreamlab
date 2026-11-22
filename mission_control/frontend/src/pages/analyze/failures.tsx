import type { ColumnDef } from "@tanstack/react-table"
import { useEffect, useMemo, useState } from "react"
import { OutcomeBadge } from "@/components/badges"
import { SERIES } from "@/components/charts"
import { DataTable, SortHeader } from "@/components/data-table"
import { JsonViewer } from "@/components/json-viewer"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  divergence, eventLog, failureOf, isIntervention, PHASES, phases, SLOT_LETTERS, type SaveFile,
} from "@/lib/analysis"
import type { Trial } from "@/lib/api"
import { humanize } from "@/lib/format"
import { cn } from "@/lib/utils"

interface FailureRow {
  key: string
  trial: Trial
  category: string
  phase: string
  why: string
  divergence: string
}

export function FailureAnalysis({ files }: { files: SaveFile[] }) {
  const defaultTarget = files.findIndex((f) => f.experiment.kind === "harness")
  const defaultReference = files.findIndex((f) => f.experiment.kind === "scripted")
  const [targetIndex, setTargetIndex] = useState(Math.max(0, defaultTarget === -1 ? files.findIndex((f) => f.experiment.kind !== "scripted") : defaultTarget))
  const [referenceIndex, setReferenceIndex] = useState(defaultReference)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    setTargetIndex((i) => Math.min(Math.max(0, i), files.length - 1))
    setReferenceIndex((i) => (i >= files.length ? -1 : i))
    setSelected(null)
  }, [files])

  const target = files[targetIndex]
  const reference = referenceIndex >= 0 ? files[referenceIndex] : undefined
  const referenceBySeed = useMemo(() => {
    const map = new Map<number, Trial>()
    for (const t of reference?.trials ?? []) if (!map.has(t.seed) || t.success) map.set(t.seed, t)
    return map
  }, [reference])

  const rows = useMemo<FailureRow[]>(() => (target?.trials ?? []).filter((t) => !t.success).map((t) => {
    const f = failureOf(t)!
    return {
      key: `${t.seed}-${t.trial}`, trial: t, category: f.category,
      phase: f.phase ? PHASES.find((p) => p.key === f.phase)?.label ?? f.phase : "—",
      why: f.why, divergence: divergence(t, referenceBySeed.get(t.seed)).text,
    }
  }), [target, referenceBySeed])

  const columns = useMemo<ColumnDef<FailureRow, unknown>[]>(() => [
    { id: "seed", accessorFn: (r) => r.trial.seed, header: ({ column }) => <SortHeader label="Seed" column={column} />, cell: ({ row }) => <span className="font-mono">{row.original.trial.seed}·t{row.original.trial.trial}</span> },
    { id: "outcome", accessorFn: (r) => r.trial.outcome, header: "Outcome", cell: ({ row }) => <OutcomeBadge outcome={row.original.trial.outcome} /> },
    { accessorKey: "category", header: ({ column }) => <SortHeader label="Category" column={column} /> },
    { accessorKey: "phase", header: "Failed in" },
    {
      accessorKey: "divergence", header: "Divergence from reference",
      cell: ({ row }) => (
        <Tooltip>
          <TooltipTrigger asChild><span className="line-clamp-1 max-w-80 text-[12px]">{row.original.divergence}</span></TooltipTrigger>
          <TooltipContent className="max-w-sm">{row.original.why} {row.original.divergence}</TooltipContent>
        </Tooltip>
      ),
    },
  ], [])

  const chosen = rows.find((r) => r.key === selected)?.trial ?? null

  if (!target) return null
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <RunPicker label="Diagnose run" files={files} value={targetIndex} onChange={(i) => { setTargetIndex(i); setSelected(null) }} />
        <RunPicker label="Reference (expected behaviour)" files={files} value={referenceIndex} allowNone
          onChange={(i) => setReferenceIndex(i)} />
        <p className="pb-2 text-[12px] text-muted-foreground">
          {rows.length} failing trial{rows.length === 1 ? "" : "s"} of {target.trials.length}. Select one to compare its trace with the other runs on the same seed.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <DataTable columns={columns} data={rows} getRowId={(r) => r.key} pageSize={10}
          onRowClick={(r) => setSelected(r.key)} empty="This run has no failing trials." />
        <div className="rounded-sm border p-3">
          {chosen ? <TraceComparison files={files} targetIndex={targetIndex} referenceIndex={referenceIndex} trial={chosen} />
            : <p className="py-10 text-center text-[13px] text-muted-foreground">Select a failing trial to inspect its trace.</p>}
        </div>
      </div>
    </div>
  )
}

function RunPicker({ label, files, value, onChange, allowNone = false }: {
  label: string; files: SaveFile[]; value: number; onChange: (index: number) => void; allowNone?: boolean
}) {
  return (
    <div className="grid gap-1">
      <span className="text-[12px] font-semibold text-foreground">{label}</span>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger size="sm" className="w-72 bg-card text-[13px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value="-1">None</SelectItem>}
          {files.map((f, i) => <SelectItem key={f.id} value={String(i)}>{SLOT_LETTERS[i]} · {f.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function TraceComparison({ files, targetIndex, referenceIndex, trial }: {
  files: SaveFile[]; targetIndex: number; referenceIndex: number; trial: Trial
}) {
  // The same seed in every loaded run (same trial number where possible).
  const lanes = files.map((f, i) => {
    const sameSeed = f.trials.filter((t) => t.seed === trial.seed)
    const match = i === targetIndex ? trial : sameSeed.find((t) => t.trial === trial.trial) ?? sameSeed[0]
    return { file: f, index: i, trial: match }
  }).filter((lane) => lane.trial)
  const maxEnd = Math.max(1, ...lanes.map((l) => phases(l.trial!).end))
  const reference = referenceIndex >= 0 ? lanes.find((l) => l.index === referenceIndex)?.trial : undefined
  const diverged = divergence(trial, reference)

  return (
    <div className="grid gap-3">
      <div>
        <h3 className="text-[13px] font-semibold">Trace comparison · seed {trial.seed}</h3>
        <p className="text-[12px] text-muted-foreground">{failureOf(trial)?.why} {diverged.text}</p>
      </div>
      <div className="grid gap-2">
        {lanes.map(({ file, index, trial: t }) => {
          const p = phases(t!)
          return (
            <div key={file.id} className="grid grid-cols-[52px_1fr] items-center gap-2">
              <span className="flex items-center gap-1 text-[12px] font-semibold">
                <span className="size-2.5 rounded-[2px]" style={{ background: SERIES[index] }} />
                {SLOT_LETTERS[index]}{index === targetIndex ? "*" : ""}
              </span>
              <div className="relative h-6 rounded-[2px] bg-muted">
                {p.spans.map((span) => {
                  const info = PHASES.find((x) => x.key === span.phase)!
                  return (
                    <Tooltip key={span.phase}>
                      <TooltipTrigger asChild>
                        <div className="absolute top-0 h-full border-r border-card"
                          style={{ left: `${(span.start / maxEnd) * 100}%`, width: `${((span.end - span.start) / maxEnd) * 100}%`, background: info.color }} />
                      </TooltipTrigger>
                      <TooltipContent>{info.label}: {span.start.toFixed(1)}–{span.end.toFixed(1)} s</TooltipContent>
                    </Tooltip>
                  )
                })}
                {(t!.interventions ?? []).filter(isIntervention).map((i, k) => (
                  <Tooltip key={k}>
                    <TooltipTrigger asChild>
                      <div className="absolute -top-1 h-8 w-0.5 bg-chart-4" style={{ left: `${(i.row / 20 / maxEnd) * 100}%` }} />
                    </TooltipTrigger>
                    <TooltipContent>Harness at {(i.row / 20).toFixed(1)} s: {humanize(i.reason)}</TooltipContent>
                  </Tooltip>
                ))}
                {index === targetIndex && diverged.at !== null && (
                  <div className="absolute -top-1 h-8 border-l-2 border-dashed border-destructive" style={{ left: `${(diverged.at / maxEnd) * 100}%` }}
                    title="Divergence point" />
                )}
              <span className="absolute top-1/2 right-1 -translate-y-1/2 rounded-sm bg-card/90 px-1 text-[10px] font-semibold text-foreground">
                  {t!.success ? "✓" : humanize(t!.outcome)}
                </span>
              </div>
            </div>
          )
        })}
        <div className="ml-[60px] flex justify-between text-[10px] text-muted-foreground"><span>0 s</span><span>{maxEnd.toFixed(0)} s</span></div>
        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          {PHASES.map((p) => <span key={p.key} className="flex items-center gap-1"><span className="size-2.5 rounded-[2px]" style={{ background: p.color }} />{p.label}</span>)}
          <span className="flex items-center gap-1"><span className="h-3 w-0.5 bg-chart-4" />Harness intervention</span>
          <span className="flex items-center gap-1"><span className="h-3 border-l-2 border-dashed border-destructive" />Divergence</span>
        </div>
      </div>
      <div className={cn("grid gap-3", reference && "md:grid-cols-2")}>
        <EventLog title={`${SLOT_LETTERS[targetIndex]} · step-by-step log`} trial={trial} />
        {reference && <EventLog title={`${SLOT_LETTERS[referenceIndex]} · reference log`} trial={reference} />}
      </div>
      <JsonViewer title="Raw trial record" data={trial} />
    </div>
  )
}

function EventLog({ title, trial }: { title: string; trial: Trial }) {
  return (
    <div className="rounded-sm border">
      <p className="border-b bg-background px-2 py-1 text-[12px] font-semibold">{title}</p>
      <ol className="max-h-48 overflow-y-auto px-2 py-1 font-mono text-[11px]">
        {eventLog(trial).map((e, i) => (
          <li key={i} className={cn("flex gap-2 py-0.5", e.kind === "intervention" && "text-warning", e.kind === "end" && !trial.success && "text-destructive")}>
            <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{e.t.toFixed(1)}s</span>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
