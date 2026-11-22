import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Save, Wallet } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { api, type AccountInfo, type FineTuneJob } from "@/lib/api"
import { dateTime, duration, usd } from "@/lib/format"
import { cn } from "@/lib/utils"

export const FINISHED = new Set(["completed", "completed_with_errors"])
const STAGES = ["Building dataset", "Uploading", "Processing dataset", "Submitting job", "Queued", "Training Dream-1", "Completed"]
const STAGE_OF_STATE: Record<string, string> = {
  preparing: "Building dataset", uploading: "Uploading", processing: "Processing dataset", submitting: "Submitting job",
  queued: "Queued", training: "Training Dream-1", completed: "Completed",
}

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
    return <p className="text-[0.8125rem] text-destructive">Could not read the Dream Labs account: {error ?? account?.error}</p>
  }
  if (!account) {
    return <p className="flex items-center gap-1 text-[0.8125rem] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Reading the Dream Labs account…</p>
  }
  return (
    <div className="rounded-sm border bg-muted p-2.5 text-[0.8125rem]">
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
      <p className="mt-1 text-[0.75rem] text-muted-foreground">
        {account.note}
        {account.remaining_usd === null && " Set DREAM_FINETUNE_BUDGET_USD before starting the console to also show what is left."}
      </p>
    </div>
  )
}

export function FineTuneJobCard({ job, onChanged }: { job: FineTuneJob; onChanged: () => void }) {
  const navigate = useNavigate()
  const [modelName, setModelName] = useState(job.model_name ?? job.name)
  const [saving, setSaving] = useState(false)
  const stages = job.external ? STAGES.slice(4) : STAGES
  const current = STAGE_OF_STATE[job.state ?? ""] ?? job.stage
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
    <div className="rounded-sm border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {done ? <CheckCircle2 className="size-4 text-success" />
            : failed ? <AlertTriangle className="size-4 text-destructive" />
              : <Loader2 className="size-4 animate-spin text-accent-foreground" />}
          <span className="text-[0.875rem] font-semibold">{job.name}</span>
          {job.job_id && <span className="font-mono text-[0.75rem] text-muted-foreground">{job.job_id}</span>}
          {job.charge && <Badge variant="outline" className="rounded-sm text-[0.75rem] font-normal">{job.charge} {job.price_usd ? usd(job.price_usd) : ""}</Badge>}
        </div>
        <span className="text-[0.8125rem] text-muted-foreground">
          {job.external ? (job.dataset_name ?? "") : `${job.sources.length} experiment${job.sources.length > 1 ? "s" : ""}`}
          {!job.external && typeof job.episodes === "number" ? ` · ${job.episodes} episodes` : ""} · {job.steps} steps · started {dateTime(job.created_at)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Progress value={job.progress * 100} className="h-1.5 flex-1" />
        <span className="w-44 shrink-0 text-right text-[0.8125rem] whitespace-nowrap tabular-nums text-muted-foreground">{status}</span>
      </div>
      <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem]">
        {stages.map((stage, index) => (
          <li key={stage} className={cn("flex items-center gap-1",
            done || index < stageIndex ? "text-success" : index === stageIndex ? "font-semibold text-accent-foreground" : "text-muted-foreground")}>
            <span className={cn("size-1.5 rounded-full", done || index < stageIndex ? "bg-success" : index === stageIndex ? "bg-primary" : "bg-input")} />
            {stage === "Training Dream-1" && index === stageIndex && job.stage !== stage ? job.stage : stage}
            {stage === "Training Dream-1" && index === stageIndex && job.step ? ` (step ${job.step}/${job.steps})` : ""}
            {stage === "Queued" && index === stageIndex && job.queue_position ? ` (#${job.queue_position})` : ""}
          </li>
        ))}
      </ol>
      {failed && job.error && <p className="mt-2 text-[0.8125rem] text-destructive">{job.error}</p>}
      {!failed && !done && job.last_error && (
        <p className="mt-2 text-[0.8125rem] text-warning">Retrying after: {job.last_error}</p>
      )}
      {done && job.model_id && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
          {!job.external && (
            <>
              <div className="grid gap-1">
                <Label className="text-[0.8125rem] font-semibold">Model name</Label>
                <Input value={modelName} onChange={(e) => setModelName(e.target.value)} className="h-8 w-56" />
              </div>
              <Button variant="outline" size="sm" className="gap-1" disabled={saving || !modelName.trim()} onClick={save}>
                <Save className="size-3.5" /> Save model
              </Button>
            </>
          )}
          <Button size="sm" className="gap-1" onClick={() => navigate(`/experiments?create=1&model=${encodeURIComponent(job.model_id!)}`)}>
            <FlaskConical className="size-3.5" /> Test model in a new experiment
          </Button>
          <span className="ml-auto font-mono text-[0.75rem] text-muted-foreground">{job.model_id}</span>
        </div>
      )}
    </div>
  )
}
