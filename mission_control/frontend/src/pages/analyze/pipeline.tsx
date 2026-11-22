import { AlertTriangle, Loader2, Rocket } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { KindBadge } from "@/components/badges"
import { AccountSpend } from "@/components/finetune"
import { JsonViewer } from "@/components/json-viewer"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { failureOf, type SaveFile } from "@/lib/analysis"
import { api, type FineTuneJob, type Trial } from "@/lib/api"
import { humanize, usd } from "@/lib/format"

interface DatasetRow {
  dataset: "D1 gold" | "D2 correction" | "D2 scripted mix"
  source: string
  // The successful trajectory this row trains on (for a correction: the scripted fix); none for an unpaired failure.
  train?: { experiment_id: string; seed: number; trial: number }
  seed: number
  trial: number
  frames: number
  instruction: string
  failure?: string
  corrects?: string
}

const frames = (t: Trial) => t.episode?.frames ?? Math.round((t.rows ?? 0) / 2)

function SourceList({ files, chosen, onToggle, filter }: {
  files: SaveFile[]; chosen: Set<string>; onToggle: (id: string, on: boolean) => void; filter?: (f: SaveFile) => boolean
}) {
  const eligible = filter ? files.filter(filter) : files
  return (
    <div className="grid max-h-56 gap-1 overflow-y-auto">
      {!eligible.length && <p className="text-[0.8125rem] text-muted-foreground">No finished experiment fits here yet.</p>}
      {eligible.map((f) => {
        return (
          <label key={f.id} className="flex items-center gap-2 rounded-sm border px-2 py-1.5 text-[0.8125rem] hover:bg-background">
            <Checkbox checked={chosen.has(f.id)} onCheckedChange={(v) => onToggle(f.id, !!v)} />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <KindBadge kind={f.experiment.kind} />
          </label>
        )
      })}
    </div>
  )
}

// The two-dataset fine-tune builder: pick the sources of each dataset, check the mix, then start a Dream Labs job.
// `preferred` (the experiments ticked on the Experiments page) narrows the starting selection.
export function PipelineBuilder({ files, preferred, onStarted }: {
  files: SaveFile[]; preferred?: string[]; onStarted: (job: FineTuneJob) => void
}) {
  const startFrom = preferred?.length ? files.filter((f) => preferred.includes(f.id)) : files
  const scripted = startFrom.filter((f) => f.experiment.kind === "scripted").map((f) => f.id)
  const failing = startFrom.filter((f) => f.experiment.kind === "harness").map((f) => f.id)
  const [d1, setD1] = useState<Set<string>>(new Set(scripted))
  const [d2Failures, setD2Failures] = useState<Set<string>>(new Set(failing.length ? failing : startFrom.filter((f) => f.experiment.kind !== "scripted").map((f) => f.id).slice(0, 1)))
  const [d2Corrections, setD2Corrections] = useState<Set<string>>(new Set(scripted))
  const [mix, setMix] = useState(30)
  const [includeUnpaired, setIncludeUnpaired] = useState(false)
  const [name, setName] = useState("dream1-ft-c3")
  const [steps, setSteps] = useState(1000)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const toggle = (setter: typeof setD1) => (id: string, on: boolean) =>
    setter((current) => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next })

  const plan = useMemo(() => {
    const byId = new Map(files.map((f) => [f.id, f]))
    const gold: DatasetRow[] = []
    for (const id of d1) {
      const f = byId.get(id)
      for (const t of f?.trials ?? []) {
        if (t.success) gold.push({
          dataset: "D1 gold", source: f!.name, seed: t.seed, trial: t.trial, frames: frames(t), instruction: f!.experiment.instruction,
          train: { experiment_id: f!.id, seed: t.seed, trial: t.trial },
        })
      }
    }
    const corrections = new Map<number, { trial: Trial; file: SaveFile }>()
    for (const id of d2Corrections) {
      const f = byId.get(id)
      for (const t of f?.trials ?? []) if (t.success && !corrections.has(t.seed)) corrections.set(t.seed, { trial: t, file: f! })
    }
    const failureRows: DatasetRow[] = []
    let unpaired = 0, infra = 0
    for (const id of d2Failures) {
      const f = byId.get(id)
      for (const t of f?.trials ?? []) {
        if (t.success) continue
        if (t.outcome === "error") { infra++; continue }
        const fix = corrections.get(t.seed)
        if (!fix) { unpaired++; if (!includeUnpaired) continue }
        failureRows.push({
          dataset: "D2 correction", source: f!.name, seed: t.seed, trial: t.trial,
          frames: fix ? frames(fix.trial) : frames(t), instruction: f!.experiment.instruction,
          failure: `${failureOf(t)?.category}: ${humanize(t.outcome)}`, corrects: fix ? `${fix.file.name} · seed ${t.seed}` : "unpaired (failure only)",
          train: fix ? { experiment_id: fix.file.id, seed: fix.trial.seed, trial: fix.trial.trial } : undefined,
        })
      }
    }
    const scriptedWanted = mix >= 100 ? 0 : Math.round((failureRows.length * mix) / (100 - mix))
    const pool = gold.length ? gold : [...corrections.values()].map(({ trial, file }) => ({
      dataset: "D1 gold" as const, source: file.name, seed: trial.seed, trial: trial.trial, frames: frames(trial), instruction: file.experiment.instruction,
      train: { experiment_id: file.id, seed: trial.seed, trial: trial.trial },
    }))
    const scriptedRows: DatasetRow[] = pool.slice(0, scriptedWanted).map((r) => ({ ...r, dataset: "D2 scripted mix" }))
    const d2Rows = [...failureRows, ...scriptedRows]
    const sum = (rows: DatasetRow[]) => rows.reduce((n, r) => n + r.frames, 0)
    return {
      gold, failureRows, scriptedRows, d2Rows, unpaired, infra, scriptedShort: scriptedWanted - scriptedRows.length,
      goldFrames: sum(gold), d2Frames: sum(d2Rows), total: gold.length + d2Rows.length,
    }
  }, [files, d1, d2Failures, d2Corrections, mix, includeUnpaired])

  const serverIds = [...new Set([...d1, ...d2Failures, ...d2Corrections])]
    .map((id) => files.find((f) => f.id === id)).filter((f) => f?.origin === "server").map((f) => f!.id)
  const trainRows = [...plan.gold, ...plan.failureRows, ...plan.scriptedRows].flatMap((r) => r.train ? [r.train] : [])
  const trainIds = [...new Set(trainRows.map((t) => t.experiment_id))]
  const trainable = trainRows.length > 0 && trainIds.every((id) => serverIds.includes(id))
  const nameOk = /^[a-z0-9-]{1,40}$/.test(name)
  const blockers = [
    !plan.gold.length && "Dataset 1 is empty: choose at least one scripted save file with successful trials.",
    !plan.failureRows.length && "Dataset 2 has no failure cases: choose a run with failing trials and a correction source with the same seeds.",
    !serverIds.length && "Pick at least one save file stored on the console server.",
    !trainable && "Every planned trajectory must come from a save file stored on the console server.",
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

  const shares = plan.total ? [
    { label: "D1 gold", n: plan.gold.length, color: "var(--chart-1)" },
    { label: "D2 corrections", n: plan.failureRows.length, color: "var(--chart-2)" },
    { label: "D2 scripted mix", n: plan.scriptedRows.length, color: "var(--chart-3)" },
  ] : []
  const sample = [...plan.gold.slice(0, 3), ...plan.failureRows.slice(0, 4), ...plan.scriptedRows.slice(0, 2)]

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-sm border p-4">
          <h3 className="text-[0.9375rem] font-semibold">Dataset 1 · Complete scripted sessions (gold standard)</h3>
          <p className="mb-3 text-[0.8125rem] text-muted-foreground">Complete, error-free executions from the scripted expert. Only successful trials are used.</p>
          <SourceList files={files} chosen={d1} onToggle={toggle(setD1)} filter={(f) => f.experiment.kind === "scripted"} />
          <p className="mt-3 text-[0.875rem]"><b>{plan.gold.length}</b> episodes · {plan.goldFrames.toLocaleString()} frames at 10 Hz</p>
        </div>
        <div className="rounded-sm border p-4">
          <h3 className="text-[0.9375rem] font-semibold">Dataset 2 · Targeted failure-correction mix</h3>
          <p className="mb-3 text-[0.8125rem] text-muted-foreground">Failure cases from the harness run, each paired with the scripted expert's corrected trajectory on the same seed, plus a share of scripted rows.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label className="mb-1 block text-[0.8125rem] font-semibold">Failures from</Label>
              <SourceList files={files} chosen={d2Failures} onToggle={toggle(setD2Failures)} filter={(f) => f.experiment.kind !== "scripted"} />
            </div>
            <div>
              <Label className="mb-1 block text-[0.8125rem] font-semibold">Corrections from</Label>
              <SourceList files={files} chosen={d2Corrections} onToggle={toggle(setD2Corrections)} filter={(f) => f.experiment.kind === "scripted"} />
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            <div className="flex items-center justify-between text-[0.8125rem]">
              <Label className="font-semibold">Scripted rows in Dataset 2</Label>
              <span className="tabular-nums">{mix}% scripted · {100 - mix}% corrections</span>
            </div>
            <Slider value={[mix]} min={0} max={80} step={5} onValueChange={([v]) => setMix(v)} />
            <label className="flex items-center gap-2 text-[0.8125rem]">
              <Checkbox checked={includeUnpaired} onCheckedChange={(v) => setIncludeUnpaired(!!v)} />
              Include failures that have no correction on the same seed ({plan.unpaired})
            </label>
          </div>
          <p className="mt-3 text-[0.875rem]">
            <b>{plan.failureRows.length}</b> failure cases · <b>{plan.scriptedRows.length}</b> scripted rows · {plan.d2Frames.toLocaleString()} frames
          </p>
          {(plan.infra > 0 || plan.scriptedShort > 0) && (
            <p className="mt-1 flex items-start gap-1 text-[0.8125rem] text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {plan.infra > 0 && `${plan.infra} infrastructure errors are left out (not policy failures). `}
              {plan.scriptedShort > 0 && `Only ${plan.scriptedRows.length} scripted episodes are available for the mix.`}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-sm border p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[0.9375rem] font-semibold">Training mix preview</h3>
          <span className="text-[0.8125rem] text-muted-foreground">{plan.total} episodes · {(plan.goldFrames + plan.d2Frames).toLocaleString()} frames</span>
        </div>
        {plan.total > 0 && (
          <>
            <div className="flex h-7 overflow-hidden rounded-sm border">
              {shares.filter((s) => s.n).map((s) => (
                <div key={s.label} className="flex items-center justify-center border-r border-card text-[0.75rem] font-semibold text-primary-foreground"
                  style={{ width: `${(s.n / plan.total) * 100}%`, background: s.color }} title={`${s.label}: ${s.n}`}>
                  {s.n / plan.total > 0.12 ? `${Math.round((s.n / plan.total) * 100)}%` : ""}
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
        <div className="mt-4 overflow-x-auto rounded-sm border">
          <Table className="text-[0.8125rem]">
            <TableHeader className="bg-background">
              <TableRow className="hover:bg-transparent">
                {["Dataset", "Source", "Seed · trial", "Failure", "Corrected by", "Frames"].map((h) => (
                  <TableHead key={h} className="h-8 px-3 text-[0.8125rem] font-semibold text-muted-foreground">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sample.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="px-3 py-1.5 whitespace-nowrap">{r.dataset}</TableCell>
                  <TableCell className="max-w-48 truncate px-3 py-1.5">{r.source}</TableCell>
                  <TableCell className="px-3 py-1.5 font-mono">{r.seed} · t{r.trial}</TableCell>
                  <TableCell className="px-3 py-1.5">{r.failure ?? "—"}</TableCell>
                  <TableCell className="max-w-56 truncate px-3 py-1.5">{r.corrects ?? "—"}</TableCell>
                  <TableCell className="px-3 py-1.5 tabular-nums">{r.frames}</TableCell>
                </TableRow>
              ))}
              {!sample.length && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No rows yet.</TableCell></TableRow>}
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
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-56" />
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
