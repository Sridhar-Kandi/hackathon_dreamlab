import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Lock, Save, Wallet } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { KindBadge } from "@/components/badges"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { api, type AccountInfo, type ExperimentSummary, type FineTuneJob } from "@/lib/api"
import { dateTime, duration, usd } from "@/lib/format"
import { cn } from "@/lib/utils"

export const FINISHED = new Set(["completed", "completed_with_errors"])
const DRY_STAGES = ["Formatting datasets", "Uploading", "Training Dream-1", "Finalizing weights"]
const STAGES = ["Building dataset", "Uploading", "Processing dataset", "Submitting job", "Queued", "Training Dream-1", "Completed"]
const STAGE_OF_STATE: Record<string, string> = {
  preparing: "Building dataset", uploading: "Uploading", processing: "Processing dataset", submitting: "Submitting job",
  queued: "Queued", training: "Training Dream-1", completed: "Completed",
}
const USD_PER_STEP = 0.2

/** What the Dream Labs account has spent on fine-tuning. The service has no balance endpoint, so this adds up job charges. */
export function AccountSpend() {
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => api.account()
      .then((a) => { if (alive) { setAccount(a); setError(null) } })
      .catch((err) => { if (alive) setError((err as Error).message) })
    load()
    const timer = setInterval(load, 60000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  if (error || account?.error) {
    return <p className="text-[12px] text-[#a4262c]">Could not read the Dream Labs account: {error ?? account?.error}</p>
  }
  if (!account) {
    return <p className="flex items-center gap-1 text-[12px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Reading the Dream Labs account…</p>
  }
  return (
    <div className="rounded-sm border bg-[#faf9f8] p-2.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1 font-semibold"><Wallet className="size-3.5" /> Fine-tuning spend</span>
        <span>Charged <b className="tabular-nums">{usd(account.charged_usd)}</b></span>
        <span>Held for running jobs <b className="tabular-nums">{usd(account.held_usd)}</b></span>
        {account.remaining_usd !== null && (
          <span>Left of {usd(account.budget_usd ?? 0)} budget <b className="tabular-nums">{usd(account.remaining_usd)}</b></span>
        )}
        <span className="text-muted-foreground">
          {account.jobs} job{account.jobs === 1 ? "" : "s"} · {account.active} active
          {account.queue ? ` · ${account.queue.slots_free}/${account.queue.slots_total} training slots free` : ""}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {account.note}
        {account.remaining_usd === null && " Set DREAM_FINETUNE_BUDGET_USD before starting the console to also show what is left."}
      </p>
    </div>
  )
}

export function FineTuneDialog({ open, onOpenChange, selected, onStarted }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: ExperimentSummary[]
  onStarted: () => void
}) {
  const [name, setName] = useState("")
  const [steps, setSteps] = useState(1000)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blocked = selected.filter((e) => !FINISHED.has(e.status))
  const nameOk = /^[a-z0-9-]{1,40}$/.test(name)
  const stepsOk = steps >= 500 && steps <= 10000 && steps % 100 === 0
  const cost = steps * USD_PER_STEP

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const job = await api.startFinetune({ name, experiment_ids: selected.map((e) => e.id), steps, confirm_charge: true })
      toast.success(`Fine-tune "${job.name}" started`, { description: `Training ${job.episodes} episodes. Progress is shown below the experiments table.` })
      onStarted()
      onOpenChange(false)
      setName("")
      setConfirmed(false)
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
          <DialogDescription>Train a new checkpoint on Dream Labs from the successful, recorded trials of the selected experiments.</DialogDescription>
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
                    : <span className="flex items-center gap-1 text-[12px] text-[#a4262c]"><Lock className="size-3" /> not run yet</span>}
                </span>
              </div>
            ))}
          </div>
          {blocked.length > 0 && (
            <p className="rounded-sm border border-[#f1bbbc] bg-[#fde7e9] p-2 text-[12px] text-[#a4262c]">
              {blocked.length} selected experiment{blocked.length > 1 ? "s have" : " has"} not finished running, so there is no data to train on.
              Deselect {blocked.length > 1 ? "them" : "it"} or wait until the run completes.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-[12px] font-semibold">Fine-tune name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="orange-bowl-c3" />
              <span className="text-[11px] text-muted-foreground">Lowercase letters, numbers and dashes. Becomes the model id.</span>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[12px] font-semibold">Training steps</Label>
              <Input type="number" min={500} max={10000} step={100} value={steps} onChange={(e) => setSteps(Number(e.target.value))} />
              <span className="text-[11px] text-muted-foreground">Multiple of 100, 500–10,000. About 8 h per 1,000.</span>
            </div>
          </div>
          <AccountSpend />
          <label className="flex items-start gap-2 rounded-sm border border-[#f9e2ae] bg-[#fff8e6] p-2 text-[12px]">
            <Checkbox className="mt-0.5" checked={confirmed} onCheckedChange={(v) => setConfirmed(!!v)} />
            <span>
              This is a real Dream Labs job. Charge about <b>{usd(cost)}</b> ({steps.toLocaleString()} steps × {usd(USD_PER_STEP)}) to the account.
              Only successful trials recorded with "Record training episodes" are used.
            </span>
          </label>
          {error && <p className="text-[12px] text-[#a4262c]">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || blocked.length > 0 || !nameOk || !stepsOk || !confirmed || !selected.length} onClick={start}>
            {busy && <Loader2 className="size-4 animate-spin" />} Start fine-tuning ({usd(cost)})
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
  const stages = job.dry_run ? DRY_STAGES : STAGES
  const current = job.dry_run ? job.stage : STAGE_OF_STATE[job.state ?? ""] ?? job.stage
  const stageIndex = stages.indexOf(current)
  const done = job.status === "completed"
  const failed = job.status === "failed"

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

  let status = `${Math.round(job.progress * 100)}%`
  if (done) status = "Done"
  else if (failed) status = "Failed"
  else if (job.eta_s !== null && job.eta_s !== undefined) status += ` · ${duration(job.eta_s)} left`

  return (
    <div className="rounded-sm border bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {done ? <CheckCircle2 className="size-4 text-[#107c10]" />
            : failed ? <AlertTriangle className="size-4 text-[#a4262c]" />
              : <Loader2 className="size-4 animate-spin text-[#0078d4]" />}
          <span className="text-[13px] font-semibold">{job.name}</span>
          {job.dry_run && <Badge variant="secondary" className="rounded-sm text-[11px] font-normal">Dry run · no model</Badge>}
          {!job.dry_run && job.charge && <Badge variant="outline" className="rounded-sm text-[11px] font-normal">{job.charge} {job.price_usd ? usd(job.price_usd) : ""}</Badge>}
        </div>
        <span className="text-[12px] text-muted-foreground">
          {job.sources.length} experiment{job.sources.length > 1 ? "s" : ""}
          {typeof job.episodes === "number" ? ` · ${job.episodes} episodes` : ""} · {job.steps} steps · started {dateTime(job.created_at)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Progress value={job.progress * 100} className="h-1.5 flex-1" />
        <span className="w-32 text-right text-[12px] tabular-nums text-muted-foreground">{status}</span>
      </div>
      <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        {stages.map((stage, index) => (
          <li key={stage} className={cn("flex items-center gap-1",
            done || index < stageIndex ? "text-[#107c10]" : index === stageIndex ? "font-semibold text-[#004578]" : "text-muted-foreground")}>
            <span className={cn("size-1.5 rounded-full", done || index < stageIndex ? "bg-[#107c10]" : index === stageIndex ? "bg-[#0078d4]" : "bg-[#c8c6c4]")} />
            {stage === "Training Dream-1" && index === stageIndex && job.stage !== stage ? job.stage : stage}
            {stage === "Training Dream-1" && index === stageIndex && job.step ? ` (step ${job.step}/${job.steps})` : ""}
            {stage === "Queued" && index === stageIndex && job.queue_position ? ` (#${job.queue_position})` : ""}
          </li>
        ))}
      </ol>
      {failed && job.error && <p className="mt-2 text-[12px] text-[#a4262c]">{job.error}</p>}
      {!failed && !done && job.last_error && (
        <p className="mt-2 text-[12px] text-[#8a5300]">Retrying after: {job.last_error}</p>
      )}
      {done && job.dry_run && (
        <p className="mt-2 text-[12px] text-muted-foreground">This job was a simulation from an earlier console version, so it has no model to run.</p>
      )}
      {done && !job.dry_run && job.model_id && (
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
