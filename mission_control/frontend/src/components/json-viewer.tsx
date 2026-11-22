import { Check, ChevronRight, Copy } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

export function JsonBlock({ data, maxHeight = 360 }: { data: unknown; maxHeight?: number }) {
  const [copied, setCopied] = useState(false)
  const text = JSON.stringify(data, null, 2)
  return (
    <div className="relative min-w-0 rounded-sm border bg-background">
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-1 right-1 h-7 gap-1 text-xs"
        onClick={() => {
          navigator.clipboard?.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </Button>
      <pre className="overflow-y-auto p-3 pr-20 font-mono text-[0.8125rem] leading-5 whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]" style={{ maxHeight }}>
        {text}
      </pre>
    </div>
  )
}

export function JsonViewer({ title, data, defaultOpen = false }: { title: string; data: unknown; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0 rounded-sm border bg-card">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-[0.875rem] font-medium hover:bg-muted">
        <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t p-2">
        <JsonBlock data={data} />
      </CollapsibleContent>
    </Collapsible>
  )
}
