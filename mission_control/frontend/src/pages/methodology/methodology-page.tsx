import { ArrowDown, ArrowRight, ChevronDown, Database, FileJson, FlaskConical, GitCompareArrows, RotateCcw, ScanLine, Sparkles, Workflow } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router-dom"
import { HarnessCapabilities } from "@/components/harness-capabilities"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const STAGES = [
  { id: "execute", title: "Run the experiments", location: "Run Task", icon: FlaskConical, summary: "A vanilla · B harness · C oracle", output: "Comparable save files", description: "Define one task, keep the starting conditions aligned, and change how the robot is controlled." },
  { id: "analyze", title: "Find the failure", location: "Analyze Experiments", icon: ScanLine, summary: "Settings → milestones → failure cases", output: "Failures linked to expert replays", description: "Compare up to three save files and trace the point where the harness run diverged from a successful reference." },
  { id: "curate", title: "Build two datasets", location: "Training mix", icon: Database, summary: "D1 gold + D2 correction mix", output: "A targeted training dataset", description: "Keep complete expert sessions and targeted corrections visible as two distinct sources, then preview their combined training mix." },
  { id: "validate", title: "Train & validate", location: "API → Run Task", icon: Sparkles, summary: "New checkpoint → held-out evaluation", output: "Evidence for the next iteration", description: "Train from the curated data, return the checkpoint to Run Task, and measure whether it improves on fresh evaluation seeds." },
]

function Detail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">{title}<ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
      <div className="border-t p-4 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </details>
  )
}

export function MethodologyPage() {
  const [activeStage, setActiveStage] = useState<string | null>("execute")
  const selected = STAGES.find((stage) => stage.id === activeStage)

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 xl:px-12">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div><p className="studio-label mb-4 flex items-center gap-2 text-muted-foreground"><Workflow aria-hidden="true" className="size-4" /> Methodology</p><h1 className="text-4xl font-normal tracking-tight">One continuous <span className="studio-highlight">learning loop.</span></h1><p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">From a controlled simulation to a checkpoint you can evaluate again. Expand a stage to see its inputs, decisions and outputs.</p></div>
        <Button asChild><Link to="/experiments?create=1">Create experiment</Link></Button>
      </header>

      <section aria-label="End-to-end architecture" className="rounded-xl border bg-card p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">Follow the evidence</h2><span className="text-xs text-muted-foreground">Click a stage to expand or collapse</span></div>
        <div className="methodology-pipeline" role="group" aria-label="Closed-loop architecture stages">
          {STAGES.map(({ id, title, location, icon: Icon, summary }, index) => (
            <div key={id} className="methodology-pipeline-step">
              <button id={`stage-${id}`} type="button" aria-expanded={activeStage === id} aria-controls="methodology-detail" onClick={() => setActiveStage(activeStage === id ? null : id)}
                className={cn("flex h-full w-full flex-col rounded-sm border p-4 text-left transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring", activeStage === id ? "border-primary bg-accent" : "bg-card")}>
                <span className="mb-4 flex w-full items-center justify-between gap-2"><Icon aria-hidden="true" className="size-5 text-primary" /><ChevronDown aria-hidden="true" className={cn("size-4 text-muted-foreground transition-transform", activeStage === id && "rotate-180")} /></span>
                <span className="text-xs text-muted-foreground">{location}</span><span className="mt-1 text-base font-semibold">{title}</span><span className="mt-3 text-sm leading-relaxed text-muted-foreground">{summary}</span>
              </button>
              {index < STAGES.length - 1 && <span aria-hidden="true" className="methodology-pipeline-connector"><ArrowRight className="size-4" /></span>}
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 rounded-sm border border-dashed border-primary/35 bg-accent/40 px-3 py-3 text-center text-sm text-accent-foreground"><RotateCcw aria-hidden="true" className="size-4 shrink-0" />Re-test on held-out seeds. Compare the evidence. Repeat the loop.</div>
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><FileJson aria-hidden="true" className="size-4 shrink-0" />Task + configuration → save files → failure cases → datasets → checkpoint → evaluation</p>
      </section>

      <section id="methodology-detail" aria-labelledby={selected ? `stage-${selected.id}` : undefined} aria-label={selected ? undefined : "Stage details"} className="mt-6">
        {selected ? (
          <div key={selected.id} className="rounded-xl border bg-card p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium text-primary">{selected.location}</p><h2 className="mt-1 text-xl font-semibold">{selected.title}</h2><p className="mt-2 max-w-3xl text-base leading-relaxed text-muted-foreground">{selected.description}</p></div><span className="rounded-sm border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">Output: {selected.output}</span></div>

            {selected.id === "execute" && <div className="grid gap-4">
              <div className="grid gap-3 lg:grid-cols-3">
                {[
                  { name: "A · Vanilla baseline", text: "Run the base Dream-1 policy without harness modules. This is the reference for unassisted model behavior.", color: "var(--chart-1)" },
                  { name: "B · Harness-assisted", text: "Use the same task and seeds with selected dream-harness modules. Record which modules intervene and how settings change.", color: "var(--chart-2)" },
                  { name: "C · Scripted / oracle", text: "Run the scripted expert from simulator state. Successful sessions supply reference trajectories and demonstrations without Dream-1 inference.", color: "var(--chart-3)" },
                ].map((mode) => <div key={mode.name} className="rounded-sm border border-t-2 p-4" style={{ borderTopColor: mode.color }}><h3 className="text-sm font-semibold">{mode.name}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{mode.text}</p></div>)}
              </div>
              <Detail title="What is configured and recorded?">
                <ul className="grid list-disc gap-2 pl-4"><li>Choose a scene, instruction, graded object and goal. Multiple task steps are delivered as one instruction and graded in order.</li><li>Set seeds, repeated trials, start jitter, simulation time, action rows per reply and the API cost cap.</li><li>Run each controller from aligned starting conditions. Physics checks record contact, lift, goal settlement and the final outcome.</li><li>Save configuration, trial results, intervention events, model-call timing, estimated cost and available playback. Save files can be downloaded for analysis elsewhere.</li></ul>
              </Detail>
              <Detail title="Choose the harness capabilities you want to ship"><HarnessCapabilities /></Detail>
              <p className="text-sm text-muted-foreground">The oracle and state-aware assists read simulator ground truth. Their steered results remain distinguishable from the vanilla model baseline.</p>
            </div>}

            {selected.id === "analyze" && <div className="grid gap-3">
              <Detail title="Compare the settings before comparing the scores">
                <p>Load up to three server save files or JSON exports from disk. Check task, scene, model, seed coverage, trials, action chunk size, time limits and harness overrides side by side. Keep comparison conditions aligned so a change has an interpretable cause.</p>
              </Detail>
              <Detail title="Trace the exact failure trajectory">
                <p>Inspect success counts, uncertainty, calls, timing and costs. Follow each trial through approach, grasp, carry and settlement using milestone rows, playback and the ordered intervention log. Compare it with a successful scripted run on the same seed to find the first missing milestone.</p>
              </Detail>
              <Detail title="Separate policy failures from infrastructure errors">
                <ul className="grid list-disc gap-2 pl-4"><li><b className="text-foreground">Approach:</b> the target was never touched.</li><li><b className="text-foreground">Grasp:</b> contact happened, but the target never lifted.</li><li><b className="text-foreground">Placement:</b> the target lifted, then missed the goal or dropped.</li><li><b className="text-foreground">Task logic:</b> wrong object, wrong order or incomplete steps.</li><li><b className="text-foreground">Infrastructure:</b> connection, timeout or simulator errors are kept separate from policy failures and excluded from correction cases.</li></ul>
              </Detail>
              <p className="flex items-start gap-2 text-sm text-muted-foreground"><GitCompareArrows aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Carry Experiment B’s failed seeds forward, paired with successful C demonstrations wherever available.</p>
            </div>}

            {selected.id === "curate" && <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-2"><div className="rounded-sm border p-4"><h3 className="text-base font-semibold">Dataset 1 · Gold standard</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Complete, successful scripted sessions teach the full pick-and-place task. Select the expert save files; unsuccessful trials are left out.</p></div><div className="rounded-sm border p-4"><h3 className="text-base font-semibold">Dataset 2 · Targeted corrections</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Select B’s failure cases and pair them with successful expert trajectories on the same seeds. Add a configurable share of scripted rows to retain broader task coverage.</p></div></div>
              <Detail title="How does a failed run become a training example?">
                <p>A failed B seed identifies a difficult starting condition. A successful C replay on that seed supplies the action trajectory to learn from; the failed actions are not treated as the desired behavior. These are expert replays from the same start, rather than recovery clips restored from a mid-run state.</p>
              </Detail>
              <Detail title="What is filtered and what can be adjusted?">
                <p>Infrastructure errors are excluded. Failures without a matching correction are excluded by default; an explicit option includes unpaired failures, which do not have a gold correction. Adjust the scripted share of Dataset 2 and inspect the episode counts, estimated frames, source rows and any shortage of scripted examples before continuing.</p>
              </Detail>
              <Detail title="How are the sources prepared for training?">
                <p>Preview the combined D1 and D2 mix in Analyze. The live training path exports recorded episodes to LeRobot format and validates the dataset before upload. Keep evaluation seeds out of the training data and retain the source configuration so the next comparison is reproducible.</p>
              </Detail>
            </div>}

            {selected.id === "validate" && <div className="grid gap-3">
              <p className="rounded-sm bg-muted/60 px-4 py-3 text-sm leading-relaxed text-muted-foreground"><b className="text-foreground">Console training is a preview.</b> The live API path is available through the training CLI. A preview job does not produce a runnable provider checkpoint.</p>
              <Detail title="Submit the curated dataset through the live API path">
                <p>Export and validate the selected episodes, upload the dataset, wait for provider processing and start a Dream-1 fine-tune with the chosen training steps. Track the returned job status and use the provider’s completed checkpoint identifier when training finishes.</p>
              </Detail>
              <Detail title="Bring the checkpoint back into Run Task">
                <p>Use the published checkpoint in a new experiment. Keep the task, limits and grading consistent with the reference, and evaluate on held-out seeds that were not used for demonstrations or correction selection. Preserve model identity and whether harness modules are enabled.</p>
              </Detail>
              <Detail title="Decide what to improve in the next loop">
                <p>Compare baseline, harness and fine-tuned runs using the same evaluation seeds. Review success counts and uncertainty alongside failure categories, interventions, calls and costs. Gains must come from the measured results. If a failure persists, collect its expert replay, revise the training mix and repeat.</p>
              </Detail>
            </div>}

            <div className="mt-5 flex flex-wrap gap-2 border-t pt-4"><Button asChild variant="outline"><Link to={selected.id === "execute" || selected.id === "validate" ? "/experiments" : "/analyze"}>{selected.id === "execute" || selected.id === "validate" ? "Open experiments" : "Open analysis"}</Link></Button><Button variant="ghost" onClick={() => setActiveStage(null)}>Collapse stage</Button></div>
          </div>
        ) : <p className="flex items-center justify-center gap-2 rounded-sm border border-dashed p-6 text-sm text-muted-foreground"><ArrowDown aria-hidden="true" className="size-4" />Select a stage above to explore its details.</p>}
      </section>
    </div>
  )
}
