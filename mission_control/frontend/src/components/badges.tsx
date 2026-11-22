import {
  AlertTriangle, Ban, CheckCircle2, CircleDashed, CircleSlash, Clock3, Loader2, XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { Kind } from "@/lib/api"
import { cn } from "@/lib/utils"
import { humanize, KIND_LABEL } from "@/lib/format"

// Status colours are reserved for state, and every badge carries an icon and a label, never colour alone.
const STATUS = {
  completed: { label: "Completed", icon: CheckCircle2, tone: "text-success bg-success-bg border-success-border" },
  completed_with_errors: { label: "Completed with errors", icon: AlertTriangle, tone: "text-warning bg-warning-bg border-warning-border" },
  running: { label: "Running", icon: Loader2, tone: "text-accent-foreground bg-accent border-accent-border" },
  queued: { label: "Queued", icon: Clock3, tone: "text-foreground bg-muted border-border" },
  stopping: { label: "Stopping", icon: Loader2, tone: "text-warning bg-warning-bg border-warning-border" },
  cancelled: { label: "Cancelled", icon: Ban, tone: "text-muted-foreground bg-muted border-border" },
  failed: { label: "Failed", icon: XCircle, tone: "text-destructive bg-danger-bg border-danger-border" },
} as const

export function StatusBadge({ status }: { status: string }) {
  const entry = STATUS[status as keyof typeof STATUS] ?? { label: humanize(status), icon: CircleDashed, tone: "" }
  const Icon = entry.icon
  return (
    <Badge variant="outline" className={cn("gap-1 rounded-sm font-normal", entry.tone)}>
      <Icon className={cn("size-3", status === "running" || status === "stopping" ? "animate-spin" : "")} />
      {entry.label}
    </Badge>
  )
}

export function OutcomeBadge({ outcome, success }: { outcome: string; success?: boolean }) {
  if (success || outcome === "success") {
    return (
      <Badge variant="outline" className="gap-1 rounded-sm font-normal text-success bg-success-bg border-success-border">
        <CheckCircle2 className="size-3" /> Success
      </Badge>
    )
  }
  if (outcome === "error") {
    return (
      <Badge variant="outline" className="gap-1 rounded-sm font-normal text-muted-foreground bg-muted border-border">
        <CircleSlash className="size-3" /> Error
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 rounded-sm font-normal text-destructive bg-danger-bg border-danger-border">
      <XCircle className="size-3" /> {humanize(outcome)}
    </Badge>
  )
}

export function KindBadge({ kind }: { kind: Kind }) {
  return (
    <Badge variant="outline" className={cn("rounded-sm font-normal text-foreground bg-card",
      kind === "recovery" && "border-success-border bg-success-bg text-success")}>
      {KIND_LABEL[kind] ?? kind}
    </Badge>
  )
}

/** Tag for experiments run on a Dream Labs fine-tuned checkpoint. */
export function FineTunedBadge() {
  return (
    <Badge variant="outline" className="rounded-sm border-warning-border bg-warning-bg font-normal text-warning">
      Fine-tuned
    </Badge>
  )
}

export function SourceBadge({ source }: { source: string }) {
  if (source === "console") return null
  return (
    <Badge variant="secondary" className="rounded-sm px-1.5 text-[0.75rem] font-normal text-muted-foreground">
      {source === "sample" ? "Sample" : "Ladder"}
    </Badge>
  )
}
