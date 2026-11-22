import { ChevronDown, Package, Settings2 } from "lucide-react"
import { MODULE_INFO } from "@/lib/harness-info"

const MODULE_GROUPS = [
  { title: "Connection & command safety", modules: ["reconnect", "clamp_gripper"] },
  { title: "Grasp & recovery", modules: ["wrong_object", "grasp_retry", "grasp_depth", "edge_pinch", "backtrack"] },
  { title: "Placement & motion", modules: ["place", "adaptive_chunking"] },
]

export function HarnessCapabilities() {
  return (
    <div className="rounded-xl border border-accent-border bg-accent/35 p-5 sm:p-7">
      <div className="flex items-start gap-3">
        <span className="studio-feature-icon shrink-0"><Package aria-hidden="true" className="size-5" /></span>
        <div>
          <h3 className="text-2xl font-normal tracking-tight">A harness you can ship.</h3>
          <p className="mt-2 max-w-3xl text-base leading-relaxed text-muted-foreground">DreamLoop includes <span className="font-medium text-foreground">dream-harness</span>, a standalone Python module for Dream-1 pick-and-place tasks. Choose the capabilities you need in Create experiment, tune their settings, and reuse the library in your own simulator workflow.</p>
        </div>
      </div>
      <div className="mt-5 grid items-start gap-3 lg:grid-cols-3">
        {MODULE_GROUPS.map((group) => (
          <details key={group.title} className="group rounded-lg border bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <span>{group.title}<span className="mt-1 block text-xs font-normal text-muted-foreground">{group.modules.length} selectable modules</span></span>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <ul className="grid gap-4 border-t px-4 py-4">
              {group.modules.map((name) => (
                <li key={name}><p className="text-sm font-semibold">{MODULE_INFO[name].label}</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{MODULE_INFO[name].description}</p></li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      <p className="mt-4 flex items-start gap-2 text-sm leading-relaxed text-muted-foreground"><Settings2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Tune replay buffers, action chunks, grasp tolerances, retry limits and connection handling per run. Simulator-aware motion and recovery modules are marked as steering in experiment results.</p>
      <details className="group mt-4 border-t pt-4">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-sm text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">Use the module outside DreamLoop<ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" /></summary>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div><p className="mb-2 text-sm text-muted-foreground">Install the wheel shipped in this repository.</p><pre className="overflow-x-auto rounded-sm border bg-muted/50 p-3 text-xs leading-relaxed"><code>python -m pip install ./wheels/dream_harness-0.1.0-py3-none-any.whl</code></pre></div>
          <div><p className="mb-2 text-sm text-muted-foreground">Select modules and override their per-run settings.</p><pre className="overflow-x-auto rounded-sm border bg-muted/50 p-3 text-xs leading-relaxed"><code>{'from dream_harness import HarnessConfig\n\nconfig = HarnessConfig.from_dict({\n    "modules": ["reconnect", "grasp_retry", "place"],\n    "values": {"MAX_SUPERVISOR_RETRIES": 2},\n})'}</code></pre></div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">The bundled runner integrates the module with Dream-1 and the Dream YAM simulator. State-aware assists need the simulator’s object and goal state.</p>
      </details>
    </div>
  )
}
