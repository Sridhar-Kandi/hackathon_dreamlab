import {
  AlertTriangle, Ban, CheckCircle2, CircleDashed, CircleSlash, Clock3, Loader2, XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { Kind } from "@/lib/api"
import { cn } from "@/lib/utils"
import { humanize, KIND_LABEL } from "@/lib/format"

// Status colours are reserved for state, and every badge carries an icon and a label, never colour alone.
const STATUS = {
  completed: { label: "Completed", icon: CheckCircle2, tone: "text-[#107c10] bg-[#dff6dd] border-[#9fd89f]" },
  completed_with_errors: { label: "Completed with errors", icon: AlertTriangle, tone: "text-[#8a5300] bg-[#fff4ce] border-[#f2d675]" },
  running: { label: "Running", icon: Loader2, tone: "text-[#004578] bg-[#eff6fc] border-[#a9d3f2]" },
  queued: { label: "Queued", icon: Clock3, tone: "text-[#323130] bg-[#f3f2f1] border-[#d2d0ce]" },
  stopping: { label: "Stopping", icon: Loader2, tone: "text-[#8a5300] bg-[#fff4ce] border-[#f2d675]" },
  cancelled: { label: "Cancelled", icon: Ban, tone: "text-[#605e5c] bg-[#f3f2f1] border-[#d2d0ce]" },
  failed: { label: "Failed", icon: XCircle, tone: "text-[#a4262c] bg-[#fde7e9] border-[#f1bbbc]" },
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
      <Badge variant="outline" className="gap-1 rounded-sm font-normal text-[#107c10] bg-[#dff6dd] border-[#9fd89f]">
        <CheckCircle2 className="size-3" /> Success
      </Badge>
    )
  }
  if (outcome === "error") {
    return (
      <Badge variant="outline" className="gap-1 rounded-sm font-normal text-[#605e5c] bg-[#f3f2f1] border-[#d2d0ce]">
        <CircleSlash className="size-3" /> Error
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 rounded-sm font-normal text-[#a4262c] bg-[#fde7e9] border-[#f1bbbc]">
      <XCircle className="size-3" /> {humanize(outcome)}
    </Badge>
  )
}

export function KindBadge({ kind }: { kind: Kind }) {
  return (
    <Badge variant="outline" className="rounded-sm font-normal text-[#323130] bg-white">
      {KIND_LABEL[kind] ?? kind}
    </Badge>
  )
}

export function SourceBadge({ source }: { source: string }) {
  if (source === "console") return null
  return (
    <Badge variant="secondary" className="rounded-sm px-1.5 text-[11px] font-normal text-muted-foreground">
      {source === "sample" ? "Sample" : "Ladder"}
    </Badge>
  )
}
