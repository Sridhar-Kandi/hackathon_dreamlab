import { Check, Database, FileJson, Fingerprint, FlaskConical, Focus, GitCompareArrows, Layers3, Play, Workflow } from "lucide-react"
import { Link } from "react-router-dom"
import dreamLabsPlayground from "@/assets/brand/dreamlabs-playground.svg"
import dreamLabsCloud from "@/assets/brand/dreamlabs-cloud.svg"
import { HarnessCapabilities } from "@/components/harness-capabilities"
import { Button } from "@/components/ui/button"

const MODES = [
  {
    letter: "A", name: "Vanilla baseline", color: "var(--chart-1)",
    setup: "Base Dream-1, without harness modules.",
    telemetry: "Success, contact / lift / settle events, latency and action rows.",
    purpose: "Establish what the model can do on its own.",
  },
  {
    letter: "B", name: "Harness-assisted", color: "var(--chart-2)",
    setup: "Dream-1 with selected recovery modules and execution settings.",
    telemetry: "The same run evidence, plus module interventions and failure labels.",
    purpose: "Expose failure patterns and measure the effect of assistance.",
  },
  {
    letter: "C", name: "Scripted / oracle", color: "var(--chart-3)",
    setup: "A scripted expert using simulator state, without model inference.",
    telemetry: "Graded expert trajectories and recorded demonstration episodes.",
    purpose: "Supply gold-standard sessions and corrections on matching seeds.",
  },
]

const FEATURES = [
  {
    icon: FlaskConical, title: "Configure & run", label: "Run Task", to: "/experiments?create=1",
    description: "One task, shared seeds, three experiment modes. Set the model, execution settings and harness modules, then save the evidence.",
    detail: "Vanilla · Harness · Scripted", action: "Create an experiment",
  },
  {
    icon: GitCompareArrows, title: "Compare & diagnose", label: "Analyze Experiments", to: "/analyze",
    description: "Compare up to three save files side by side. Inspect configuration differences and trace failures from contact to final placement.",
    detail: "Configuration · Trajectories · Failure labels", action: "Open the analysis studio",
  },
  {
    icon: Database, title: "Curate & fine-tune", label: "Two-dataset pipeline", to: "/analyze",
    description: "Combine successful expert sessions with corrections for failed seeds. Preview the training mix, follow the API training path and re-test the checkpoint.",
    detail: "Gold sessions + targeted corrections", action: "Explore the training pipeline",
  },
]

function ModeLabel({ mode }: { mode: typeof MODES[number] }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-sm border text-xs" style={{ color: mode.color, borderColor: mode.color }}>{mode.letter}</span>
      {mode.name}
    </span>
  )
}

export function OverviewPage() {
  return (
    <div className="overview-page mx-auto max-w-[1440px] px-5 py-9 sm:px-8 xl:px-12 xl:py-12">
      <section aria-labelledby="overview-title" className="grid items-center gap-9 border-b pb-12 xl:grid-cols-[1.2fr_1fr] xl:gap-12">
        <div>
          <p className="studio-label mb-6 flex items-center gap-2 text-muted-foreground"><Workflow aria-hidden="true" className="size-4" /> Dream-1 evaluation studio</p>
          <h1 id="overview-title" className="flex items-center gap-4 text-5xl leading-none font-normal tracking-[-0.035em] sm:text-6xl xl:text-7xl">DreamLoop<img src={dreamLabsCloud} alt="" aria-hidden="true" className="studio-logo hidden max-w-14 opacity-75 sm:block" /></h1>
          <p className="mt-6 max-w-xl text-3xl leading-[1.12] font-normal tracking-tight sm:text-4xl">Every experiment.<br /><span className="studio-highlight">A little more capable.</span></p>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">Evaluate Dream-1 in DreamLab, diagnose its failures and turn expert demonstrations into targeted fine-tuning data—all in one loop.</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button asChild variant="secondary" size="lg"><Link to="/experiments?create=1"><Play aria-hidden="true" className="size-4" /> Launch experiment</Link></Button>
            <Button asChild variant="outline" size="lg"><Link to="/methodology">How it works</Link></Button>
          </div>
          <p className="mt-5 text-sm text-muted-foreground">One task. Comparable runs. Evidence for what to improve.</p>
        </div>

        <aside aria-label="Physics-grounded evaluation" className="overview-signal-panel relative overflow-hidden rounded-2xl border border-accent-border p-6 sm:p-7">
          <div className="mb-4 flex items-center justify-between gap-3"><span className="studio-label text-accent-foreground">Observe. Understand. Improve.</span><span className="rounded-full bg-card/80 px-2.5 py-1 text-xs text-muted-foreground">Dream YAM Sim</span></div>
          <img src={dreamLabsPlayground} alt="" aria-hidden="true" className="mx-auto mb-5 h-36 w-full object-contain sm:h-40" />
          <div className="flex items-center justify-between gap-3">
            <span className="text-lg font-medium">See what actually happened.</span>
            <Focus aria-hidden="true" className="size-5 text-primary" />
          </div>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Grade what actually happened, using the simulator’s physics state.</p>
          <div className="relative mt-7 grid grid-cols-3 gap-2">
            <div aria-hidden="true" className="absolute top-5 right-[16.66%] left-[16.66%] border-t border-dashed border-primary/40" />
            {[
              { icon: Fingerprint, title: "Contact", detail: "Object touched" },
              { icon: Layers3, title: "Lift", detail: "Object raised" },
              { icon: Check, title: "Settle", detail: "Goal verified" },
            ].map(({ icon: Icon, title, detail }) => (
              <div key={title} className="relative flex flex-col items-center text-center">
                <span className="flex size-10 items-center justify-center rounded-xl border border-accent-border bg-card text-primary"><Icon aria-hidden="true" className="size-5" /></span>
                <span className="mt-3 text-sm font-semibold">{title}</span>
                <span className="mt-1 text-xs text-muted-foreground">{detail}</span>
              </div>
            ))}
          </div>
          <div className="mt-7 flex items-start gap-2.5 border-t pt-4">
            <FileJson aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-sm leading-relaxed text-muted-foreground">Every save file connects the settings you chose to the outcome you can inspect.</p>
          </div>
        </aside>
      </section>

      <section aria-labelledby="workflow-title" className="pt-9">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
          <h2 id="workflow-title" className="text-2xl font-normal tracking-tight">Run it. Find the failure. Teach the fix.</h2>
          <span className="text-sm text-muted-foreground">Your workflow, from first run to next checkpoint</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, label, to, description, detail, action }, index) => (
            <article key={title} className="studio-feature-card flex flex-col rounded-xl border bg-card p-6">
              <div className="flex items-center gap-3"><span className="studio-feature-icon" style={index === 1 ? { background: "var(--brand-lavender)" } : index === 2 ? { background: "var(--brand-grass-light)" } : undefined}><Icon aria-hidden="true" className="size-5" /></span><span className="studio-label text-muted-foreground">{label}</span></div>
              <h3 className="mt-5 text-xl font-medium">{title}</h3>
              <p className="mt-2 text-base leading-relaxed text-muted-foreground">{description}</p>
              <p className="mt-4 mb-5 text-xs text-muted-foreground">{detail}</p>
              <Link to={to} className="mt-auto w-fit rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{action}</Link>
            </article>
          ))}
        </div>
      </section>

      <section aria-label="Shippable pick-and-place harness" className="pt-10"><HarnessCapabilities /></section>

      <section aria-labelledby="modes-title" className="pt-10">
        <div className="mb-5">
          <p className="studio-label mb-2 text-muted-foreground">The experiment design</p>
          <h2 id="modes-title" className="text-2xl font-normal tracking-tight">Three modes. A clearer comparison.</h2>
          <p id="modes-description" className="mt-2 text-base text-muted-foreground">Keep the task and seeds aligned. Change how the robot is controlled.</p>
        </div>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table aria-describedby="modes-description" className="w-full min-w-[720px] border-collapse text-left text-sm">
            <caption className="sr-only">Configuration, telemetry and purpose of the three experiment modes</caption>
            <thead className="border-b bg-muted/60 text-xs text-muted-foreground">
              <tr>{["Experiment mode", "How it is configured", "Evidence it produces", "Why it matters"].map((heading) => <th key={heading} scope="col" className="px-5 py-3 font-semibold">{heading}</th>)}</tr>
            </thead>
            <tbody>
              {MODES.map((mode) => (
                <tr key={mode.letter} className="border-b last:border-b-0 hover:bg-muted/30">
                  <th scope="row" className="w-[23%] px-5 py-5 font-normal"><ModeLabel mode={mode} /></th>
                  <td className="w-[24%] px-5 py-5 align-top leading-relaxed text-muted-foreground">{mode.setup}</td>
                  <td className="w-[28%] px-5 py-5 align-top leading-relaxed text-muted-foreground">{mode.telemetry}</td>
                  <td className="px-5 py-5 align-top leading-relaxed">{mode.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-muted-foreground"><GitCompareArrows aria-hidden="true" className="mt-0.5 size-4 shrink-0" />The oracle supplies demonstrations; its access to simulator state makes it a reference, not an unassisted model score.</p>
      </section>

      <section aria-label="Start your first experiment" className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t pt-7 pb-2">
        <div><h2 className="text-lg font-semibold">Start with a run. Leave with a reason.</h2><p className="mt-1 text-sm text-muted-foreground">Configure your first experiment or explore the sample save files in Analyze.</p></div>
        <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to="/analyze">Explore comparisons</Link></Button><Button asChild><Link to="/experiments?create=1">Launch experiment</Link></Button></div>
      </section>
    </div>
  )
}
