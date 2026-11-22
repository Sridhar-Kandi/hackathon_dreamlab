import { CheckCircle2, FlaskConical, Loader2, Lock, Save } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { KindBadge } from "@/components/badges"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { api, type ExperimentSummary, type FineTuneJob } from "@/lib/api"
import { dateTime, duration, usd } from "@/lib/format"
import { cn } from "@/lib/utils"

export const FINISHED = new Set(["completed", "completed_with_errors"])
const STAGES = ["Formatting datasets", "Uploading", "Training Dream-1", "Finalizing weights"]

export function FineTuneDialog({ open, onOpenChange, selected, onStarted }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: ExperimentSummary[]
  onStarted: () => void
}) {
  const [name, setName] = useState("")
  const [steps, setSteps] = useState(1000)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blocked = selected.filter((e) => !FINISHED.has(e.status))
  const nameOk = /^[\w.-]{1,60}$/.test(name)

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const job = await api.startFinetune({ name, experiment_ids: selected.map((e) => e.id), steps })
      toast.success(`Fine-tune "${job.name}" started`, { description: "Progress is shown below the experiments table." })
      onStarted()
      onOpenChange(false)
      setName("")
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Fine-tune Dream-1</DialogTitle>
          <DialogDescription>Train a new checkpoint on the trials of the selected experiments.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="max-h-48 overflow-y-auto rounded-sm border">
            {selected.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 border-b px-3 py-2 text-[13px] last:border-0">
                <span className="truncate">{e.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <KindBadge kind={e.kind} />
                  {FINISHED.has(e.status)
                    ? <span className="text-[12px] text-muted-foreground">{e.successes}/{e.graded} ok</span>
                    : <span className="flex items-center gap-1 text-[12px] text-destructive"><Lock className="size-3" /> not run yet</span>}
                </span>
              </div>
            ))}
          </div>
          {blocked.length > 0 && (
            <p className="rounded-sm border border-danger-border bg-danger-bg p-2 text-[12px] text-destructive">
              {blocked.length} selected experiment{blocked.length > 1 ? "s have" : " has"} not finished running, so there is no data to train on.
              Deselect {blocked.length > 1 ? "them" : "it"} or wait until the run completes.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-[12px] font-semibold">Fine-tune name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="orange-bowl-c3" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[12px] font-semibold">Training steps</Label>
              <Input type="number" min={50} max={5000} value={steps} onChange={(e) => setSteps(Number(e.target.value))} />
            </div>
          </div>
          <p className="text-[12px] text-muted-foreground">
            Dry run: the console simulates the Dream fine-tuning API (stages, timing, returned model id). Nothing is uploaded or billed.
            A live job of this size would cost about {usd(steps * 0.2)}.
          </p>
          {error && <p className="text-[12px] text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || blocked.length > 0 || !nameOk || !selected.length} onClick={start}>
            {busy && <Loader2 className="size-4 animate-spin" />} Start fine-tuning
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function FineTuneJobCard({ job, onChanged }: { job: FineTuneJob; onChanged: () => void }) {
  const navigate = useNavigate()
  const [modelName, setModelName] = useState(job.model_name ?? job.name)
  const [saving, setSaving] = useState(false)
  const stageIndex = STAGES.indexOf(job.stage)
  const done = job.status === "completed"

  async function save() {
    setSaving(true)
    try {
      await api.saveModel(job.id, modelName)
      toast.success(`Model saved as "${modelName}"`)
      onChanged()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-sm border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {done ? <CheckCircle2 className="size-4 text-success" /> : <Loader2 className="size-4 animate-spin text-accent-foreground" />}
          <span className="text-[13px] font-semibold">{job.name}</span>
          {job.dry_run && <Badge variant="secondary" className="rounded-sm text-[11px] font-normal">Dry run</Badge>}
        </div>
        <span className="text-[12px] text-muted-foreground">
          {job.sources.length} experiment{job.sources.length > 1 ? "s" : ""} · {job.steps} steps · started {dateTime(job.created_at)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Progress value={job.progress * 100} className="h-1.5 flex-1" />
        <span className="w-28 text-right text-[12px] tabular-nums text-muted-foreground">
          {done ? "Done" : `${Math.round(job.progress * 100)}% · ${duration(job.eta_s)} left`}
        </span>
      </div>
      <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        {STAGES.map((stage, index) => (
          <li key={stage} className={cn("flex items-center gap-1",
            done || index < stageIndex ? "text-success" : index === stageIndex ? "font-semibold text-accent-foreground" : "text-muted-foreground")}>
            <span className={cn("size-1.5 rounded-full", done || index < stageIndex ? "bg-success" : index === stageIndex ? "bg-primary" : "bg-input")} />
            {stage}{stage === "Training Dream-1" && index === stageIndex ? ` (step ${job.step}/${job.steps})` : ""}
          </li>
        ))}
      </ol>
      {done && job.model_id && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
          <div className="grid gap-1">
            <Label className="text-[12px] font-semibold">Model name</Label>
            <Input value={modelName} onChange={(e) => setModelName(e.target.value)} className="h-8 w-56" />
          </div>
          <Button variant="outline" size="sm" className="gap-1" disabled={saving || !modelName.trim()} onClick={save}>
            <Save className="size-3.5" /> Save model
          </Button>
          <Button size="sm" className="gap-1" onClick={() => navigate(`/experiments?create=1&model=${encodeURIComponent(job.model_id!)}`)}>
            <FlaskConical className="size-3.5" /> Test model in a new experiment
          </Button>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">{job.model_id}</span>
        </div>
      )}
    </div>
  )
}
