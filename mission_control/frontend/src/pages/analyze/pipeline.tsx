import { AlertTriangle, CheckCircle2, Circle, Loader2, Rocket } from "lucide-react"
import { useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { KindBadge } from "@/components/badges"
import { AccountSpend } from "@/components/finetune"
import { JsonViewer } from "@/components/json-viewer"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { trialReason, type SaveFile } from "@/lib/analysis"
import { api, type FineTuneJob, type Trial } from "@/lib/api"
import { usd } from "@/lib/format"
import { cn } from "@/lib/utils"

type DatasetChoice = "d1" | "d2"

interface DatasetRow {
  part: "Teacher demo" | "Teacher correction" | "Harness success"
  source: string
  // The successful trajectory this row trains on.
  train: { experiment_id: string; seed: number; trial: number }
  seed: number
  trial: number
  frames: number
  note?: string
}

const frames = (t: Trial) => t.episode?.frames ?? Math.round((t.rows ?? 0) / 2)

function SourceList({ files, chosen, onToggle, empty, describe }: {
  files: SaveFile[]; chosen: Set<string>; onToggle: (id: string, on: boolean) => void; empty: string
  describe?: (f: SaveFile) => ReactNode
}) {
  return (
    <div className="grid max-h-56 gap-1 overflow-y-auto">
      {!files.length && <p className="text-[0.8125rem] text-muted-foreground">{empty}</p>}
      {files.map((f) => (
        <label key={f.id} className="flex min-w-0 items-center gap-2 rounded-sm border px-2 py-1.5 text-[0.8125rem] hover:bg-background">
          <Checkbox checked={chosen.has(f.id)} onCheckedChange={(v) => onToggle(f.id, !!v)} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{f.name}</span>
            {describe && <span className="block truncate text-[0.75rem] text-muted-foreground">{describe(f)}</span>}
          </span>
          <KindBadge kind={f.experiment.kind} />
        </label>
      ))}
    </div>
  )
}

/** One dataset option. The chosen one is raised; the other is faded and inactive until it is chosen instead. */
function DatasetCard({ active, onChoose, title, description, children }: {
  active: boolean; onChoose: () => void; title: string; description: string; children: ReactNode
}) {
  return (
    <div className={cn("relative rounded-sm border bg-card p-4 transition-all",
      active ? "z-10 -translate-y-0.5 border-ring shadow-lg ring-2 ring-ring/40" : "z-0 opacity-50")}>
      <button type="button" onClick={onChoose} aria-pressed={active}
        className="mb-1 flex w-full cursor-pointer items-start gap-2 text-left">
        {active ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent-foreground" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <span>
          <span className="block text-[0.9375rem] font-semibold">{title}</span>
          <span className="block text-[0.8125rem] text-muted-foreground">{description}</span>
          {!active && <span className="mt-1 block text-[0.8125rem] font-medium text-accent-foreground">Use this dataset instead</span>}
        </span>
      </button>
      <div className={cn("mt-3", !active && "pointer-events-none select-none")} aria-disabled={!active} inert={!active}>
        {children}
      </div>
    </div>
  )
}

// The fine-tune builder: choose one dataset (scripted gold sessions, or failure corrections plus harness successes),
// check what goes in, then start a Dream Labs job. `preferred` (the experiments ticked on the Experiments page)
// picks the starting dataset and sources.
export function PipelineBuilder({ files, preferred, onStarted }: {
  files: SaveFile[]; preferred?: string[]; onStarted: (job: FineTuneJob) => void
}) {
  const byId = useMemo(() => new Map(files.map((f) => [f.id, f])), [files])
  const scripted = files.filter((f) => f.experiment.kind === "scripted")
  const recoveries = files.filter((f) => f.experiment.kind === "recovery")
  const pick = (list: SaveFile[]) => {
    const wanted = list.filter((f) => preferred?.includes(f.id))
    return new Set((wanted.length ? wanted : preferred?.length ? [] : list).map((f) => f.id))
  }
  const [choice, setChoice] = useState<DatasetChoice>(
    recoveries.some((f) => preferred?.includes(f.id)) && !scripted.some((f) => preferred?.includes(f.id)) ? "d2" : "d1")
  const [d1, setD1] = useState<Set<string>>(() => pick(scripted))
  const [d2, setD2] = useState<Set<string>>(() => pick(recoveries))
  const [name, setName] = useState("dream1-ft-c3")
  const [steps, setSteps] = useState(1000)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const toggle = (setter: typeof setD1) => (id: string, on: boolean) =>
    setter((current) => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next })

  // Dataset 1: every successful trial of the chosen scripted experiments.
  const d1Rows = useMemo(() => {
    const rows: DatasetRow[] = []
    for (const id of d1) {
      const f = byId.get(id)
      for (const t of f?.trials ?? []) {
        if (t.success) rows.push({ part: "Teacher demo", source: f!.name, seed: t.seed, trial: t.trial, frames: frames(t),
          train: { experiment_id: f!.id, seed: t.seed, trial: t.trial } })
      }
    }
    return rows
  }, [d1, byId])

  // Dataset 2: for each chosen "success from failures" experiment, its teacher corrections plus the successes of the
  // harness experiment it replays.
  const d2Plan = useMemo(() => {
    const corrections: DatasetRow[] = []
    const harnessSuccesses: DatasetRow[] = []
    const missing: string[] = []
    let teacherMisses = 0
    const harnessDone = new Set<string>()
    for (const id of d2) {
      const recovery = byId.get(id)
      if (!recovery) continue
      const sourceId = recovery.experiment.source_experiment?.id
      const harness = sourceId ? byId.get(sourceId) : undefined
      if (!harness) missing.push(recovery.experiment.source_experiment?.name ?? recovery.name)
      for (const t of recovery.trials) {
        if (!t.success) { teacherMisses++; continue }
        const failed = harness?.trials.find((h) => h.seed === t.seed && !h.success)
        corrections.push({ part: "Teacher correction", source: recovery.name, seed: t.seed, trial: t.trial, frames: frames(t),
          train: { experiment_id: recovery.id, seed: t.seed, trial: t.trial },
          note: failed ? `Fixes: ${trialReason(failed)}` : undefined })
      }
      if (harness && !harnessDone.has(harness.id)) {
        harnessDone.add(harness.id)
        for (const t of harness.trials) {
          if (t.success) harnessSuccesses.push({ part: "Harness success", source: harness.name, seed: t.seed, trial: t.trial,
            frames: frames(t), train: { experiment_id: harness.id, seed: t.seed, trial: t.trial } })
        }
      }
    }
    return { corrections, harnessSuccesses, missing, teacherMisses }
  }, [d2, byId])

  const rows = choice === "d1" ? d1Rows : [...d2Plan.corrections, ...d2Plan.harnessSuccesses]
  const totalFrames = rows.reduce((n, r) => n + r.frames, 0)
  const trainRows = rows.map((r) => r.train)
  const trainIds = [...new Set(trainRows.map((t) => t.experiment_id))]
  const allOnServer = trainIds.every((id) => byId.get(id)?.origin === "server")
  const nameOk = /^[a-z0-9-]{1,40}$/.test(name)
  const blockers = [
    choice === "d1" && !d1Rows.length && "Dataset 1 is empty: choose at least one scripted experiment with successful trials.",
    choice === "d2" && !d2.size && "Choose a “Success from failures” experiment. Create one from a harness experiment on the Experiments page.",
    choice === "d2" && d2.size > 0 && !d2Plan.corrections.length && "The chosen experiments have no successful teacher corrections yet.",
    choice === "d2" && d2Plan.missing.length > 0 && `The harness experiment “${d2Plan.missing[0]}” is not finished or no longer exists.`,
    !allOnServer && "Every trajectory must come from an experiment stored on the console server.",
    !nameOk && "Name the fine-tune with lowercase letters, numbers and dashes (up to 40).",
    (steps < 500 || steps > 10000 || steps % 100 !== 0) && "Training steps must be a multiple of 100 between 500 and 10,000.",
    !confirmed && "Tick the box to authorize the Dream Labs charge.",
  ].filter(Boolean) as string[]

  async function start() {
    setBusy(true)
    try {
      const created = await api.startFinetune({ name, experiment_ids: trainIds, steps, trials: trainRows, confirm_charge: true })
      toast.success(`Fine-tune "${created.name}" started`)
      onStarted(created)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const shares = choice === "d1"
    ? [{ label: "Teacher demos", n: d1Rows.length, color: "var(--chart-1)" }]
    : [
      { label: "Teacher corrections", n: d2Plan.corrections.length, color: "var(--chart-2)" },
      { label: "Harness successes", n: d2Plan.harnessSuccesses.length, color: "var(--chart-3)" },
    ]
  const sample = choice === "d1" ? d1Rows.slice(0, 8) : [...d2Plan.corrections.slice(0, 5), ...d2Plan.harnessSuccesses.slice(0, 3)]

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <DatasetCard active={choice === "d1"} onChoose={() => setChoice("d1")}
          title="Dataset 1 · Complete scripted sessions (gold standard)"
          description="Complete, error-free executions from the scripted expert. Only successful trials are used.">
          <SourceList files={scripted} chosen={d1} onToggle={toggle(setD1)} empty="No finished scripted experiment yet." />
          <p className="mt-3 text-[0.875rem]"><b>{d1Rows.length}</b> episodes · {d1Rows.reduce((n, r) => n + r.frames, 0).toLocaleString()} frames at 10 Hz</p>
        </DatasetCard>
        <DatasetCard active={choice === "d2"} onChoose={() => setChoice("d2")}
          title="Dataset 2 · Failure corrections + harness successes"
          description="The scripted expert's runs from the exact starts where a harness experiment failed, plus that harness experiment's own successes.">
          <SourceList files={recoveries} chosen={d2} onToggle={toggle(setD2)}
            empty="No “Success from failures” experiment yet. On the Experiments page, add an experiment with that controller and pick a harness run."
            describe={(f) => `replays the failures of “${f.experiment.source_experiment?.name ?? "?"}”`} />
          <p className="mt-3 text-[0.875rem]">
            <b>{d2Plan.corrections.length}</b> teacher corrections · <b>{d2Plan.harnessSuccesses.length}</b> harness successes
          </p>
          {d2Plan.teacherMisses > 0 && (
            <p className="mt-1 flex items-start gap-1 text-[0.8125rem] text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {d2Plan.teacherMisses} replayed seed{d2Plan.teacherMisses > 1 ? "s" : ""} the scripted expert did not solve are left out.
            </p>
          )}
        </DatasetCard>
      </div>

      <div className="min-w-0 rounded-sm border p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[0.9375rem] font-semibold">Training mix preview · {choice === "d1" ? "Dataset 1" : "Dataset 2"}</h3>
          <span className="text-[0.8125rem] text-muted-foreground">{rows.length} episodes · {totalFrames.toLocaleString()} frames</span>
        </div>
        {rows.length > 0 && (
          <>
            <div className="flex h-7 overflow-hidden rounded-sm border">
              {shares.filter((s) => s.n).map((s) => (
                <div key={s.label} className="flex items-center justify-center border-r border-card text-[0.75rem] font-semibold text-primary-foreground"
                  style={{ width: `${(s.n / rows.length) * 100}%`, background: s.color }} title={`${s.label}: ${s.n}`}>
                  {s.n / rows.length > 0.12 ? `${Math.round((s.n / rows.length) * 100)}%` : ""}
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-4 text-[0.8125rem] text-foreground">
              {shares.map((s) => (
                <span key={s.label} className="flex items-center gap-1"><span className="size-2.5 rounded-[2px]" style={{ background: s.color }} />{s.label}: {s.n}</span>
              ))}
            </div>
          </>
        )}
        <div className="mt-4 rounded-sm border">
          <Table className="text-[0.8125rem]">
            <TableHeader className="bg-background">
              <TableRow className="hover:bg-transparent">
                {["Part", "Source", "Seed · trial", "Note", "Frames"].map((h) => (
                  <TableHead key={h} className="h-8 px-3 text-[0.8125rem] font-semibold text-muted-foreground">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sample.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="px-3 py-1.5 whitespace-nowrap">{r.part}</TableCell>
                  <TableCell className="max-w-48 truncate px-3 py-1.5">{r.source}</TableCell>
                  <TableCell className="px-3 py-1.5 font-mono whitespace-nowrap">{r.seed} · t{r.trial}</TableCell>
                  <TableCell className="px-3 py-1.5 whitespace-normal [overflow-wrap:anywhere]">{r.note ?? "—"}</TableCell>
                  <TableCell className="px-3 py-1.5 tabular-nums">{r.frames}</TableCell>
                </TableRow>
              ))}
              {!sample.length && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No rows yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <div className="mt-2">
          <JsonViewer title="Inspect sample rows (JSON)" data={sample} />
        </div>
      </div>

      <div className="rounded-sm border p-4">
        <h3 className="mb-3 text-[0.9375rem] font-semibold">Fine-tuning execution</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label className="text-[0.8125rem] font-semibold">Fine-tune name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} className="h-8 w-56" />
          </div>
          <div className="grid gap-1">
            <Label className="text-[0.8125rem] font-semibold">Training steps</Label>
            <Input type="number" min={500} max={10000} step={100} value={steps} onChange={(e) => setSteps(Number(e.target.value))} className="h-8 w-32" />
          </div>
          <div className="grid gap-1">
            <Label className="text-[0.8125rem] font-semibold">Base model</Label>
            <Input value="dreamlabs/dream-1-beta" disabled className="h-8 w-56 font-mono text-[0.8125rem]" />
          </div>
          <Button className="gap-1" disabled={busy || blockers.length > 0} onClick={start}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />} Start fine-tuning
          </Button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-[0.8125rem]">
          <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(!!v)} />
          Train {trainRows.length} trajectories on Dream Labs and charge about <b>{usd(steps * 0.2)}</b> to the account
        </label>
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">
          {blockers.length ? <span className="text-warning">{blockers[0]}</span>
            : "Real fine-tune: the dataset is built from the recorded episodes, uploaded and trained by Dream Labs (about 8 hours per 1,000 steps). The model becomes runnable here when its checkpoint is published."}
        </p>
        <div className="mt-3"><AccountSpend /></div>
      </div>
    </div>
  )
}
