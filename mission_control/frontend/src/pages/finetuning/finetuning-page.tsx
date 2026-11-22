import { RefreshCw, Sparkles } from "lucide-react"
import { useState } from "react"
import { PageHeader } from "@/components/app-shell"
import { AccountSpend, FineTuneJobCard } from "@/components/finetune"
import { FineTuneModal } from "@/components/finetune-modal"
import { Button } from "@/components/ui/button"
import { useExperiments } from "@/lib/hooks"

export function FineTuningPage() {
  const { finetunes, loading, error, refresh } = useExperiments()
  const [open, setOpen] = useState(false)

  return (
    <div>
      <PageHeader
        title="Fine-tuning"
        description="Every Dream Labs fine-tuning job on this account, with live progress. A finished job's model can be tested in a new experiment."
        actions={
          <>
            <Button variant="ghost" size="sm" className="gap-1" onClick={refresh}>
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
            <Button size="sm" className="gap-1" onClick={() => setOpen(true)}>
              <Sparkles className="size-4" /> Fine-tune
            </Button>
          </>
        }
      />
      <div className="grid gap-4 p-6">
        <AccountSpend />
        {error && <p className="text-[0.875rem] text-destructive">{error}</p>}
        {finetunes.map((job) => <FineTuneJobCard key={job.id} job={job} onChanged={refresh} />)}
        {!finetunes.length && (
          <p className="rounded-sm border bg-card px-4 py-10 text-center text-[0.875rem] text-muted-foreground">
            {loading ? "Loading fine-tuning jobs…" : "No fine-tuning jobs yet. Click Fine-tune to start one."}
          </p>
        )}
      </div>
      <FineTuneModal open={open} onOpenChange={setOpen} onStarted={refresh} />
    </div>
  )
}
