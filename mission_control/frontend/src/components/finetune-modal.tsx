import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import type { SaveFile } from "@/lib/analysis"
import { api, type FineTuneJob } from "@/lib/api"
import { PipelineBuilder } from "@/pages/analyze/pipeline"

const FINISHED = new Set(["completed", "completed_with_errors"])

/** Choose one training dataset, then start the Dream Labs job.
 *  Opened from the Fine-tuning page and from the Experiments page (with the ticked experiments preselected). */
export function FineTuneModal({ open, onOpenChange, preferred, onStarted }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  preferred?: string[]
  onStarted: (job: FineTuneJob) => void
}) {
  const [files, setFiles] = useState<SaveFile[] | null>(null)

  // Load every finished experiment's save file each time the modal opens, so new runs are always offered.
  useEffect(() => {
    if (!open) {
      setFiles(null)
      return
    }
    let alive = true
    api.experiments()
      .then(({ experiments }) => {
        const finished = experiments.filter((e) => FINISHED.has(e.status))
        return Promise.all(finished.map((e) => api.experiment(e.id)))
      })
      .then((details) => {
        if (!alive) return
        setFiles(details.map((d) => ({
          id: d.summary.id, name: d.summary.name, origin: "server", source: d.summary.source, experiment: d.experiment,
          status: d.status, request: d.request, trials: d.trials, analytics: d.analytics,
        })))
      })
      .catch((err) => {
        if (alive) toast.error((err as Error).message)
      })
    return () => { alive = false }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-sm sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Fine-tune Dream-1</DialogTitle>
          <DialogDescription>
            Choose one dataset. Dataset 1 uses complete scripted sessions. Dataset 2 combines successful teacher
            corrections with successful trials from the linked harness experiment.
          </DialogDescription>
        </DialogHeader>
        {files === null
          ? <p className="flex items-center gap-2 py-10 text-[0.875rem] text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading finished experiments…</p>
          : (
            <PipelineBuilder
              files={files}
              preferred={preferred}
              onStarted={(job) => {
                onOpenChange(false)
                onStarted(job)
              }}
            />
          )}
      </DialogContent>
    </Dialog>
  )
}
