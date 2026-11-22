import { BarChart3, BookOpen, ExternalLink, FlaskConical, LayoutDashboard, ListOrdered } from "lucide-react"
import type { ReactNode } from "react"
import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"

const NAV = [
  { to: "/experiments", label: "Experiments", icon: FlaskConical },
  { to: "/analyze", label: "Analyze & fine-tune", icon: BarChart3 },
]

// Pages not yet moved to the new console open in the classic one.
const CLASSIC = [
  { href: "/classic#workspace", label: "Overview", icon: LayoutDashboard },
  { href: "/classic#ladder", label: "Ladder", icon: ListOrdered },
  { href: "/classic#flow", label: "How it works", icon: BookOpen },
]

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-white px-4">
        <div className="flex size-7 items-center justify-center rounded-sm bg-primary text-[11px] font-bold text-white">YS</div>
        <span className="text-[15px] font-semibold text-[#201f1e]">YAM Simulation Console</span>
        <span className="text-[13px] text-muted-foreground">Dream-1 · DreamLab simulator</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-56 shrink-0 border-r bg-white py-3" aria-label="Main">
          <p className="px-4 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Workflow</p>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => cn(
                "mx-2 flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-[13px] text-[#323130] hover:bg-[#f3f2f1]",
                isActive && "bg-[#eff6fc] font-semibold text-[#004578] shadow-[inset_2px_0_0_#0078d4]",
              )}
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
          <p className="px-4 pt-5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Classic console</p>
          {CLASSIC.map(({ href, label, icon: Icon }) => (
            <a key={href} href={href}
              className="mx-2 flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-[13px] text-[#323130] hover:bg-[#f3f2f1]">
              <Icon className="size-4" />
              {label}
              <ExternalLink className="ml-auto size-3 text-muted-foreground" />
            </a>
          ))}
        </nav>
        <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
      </div>
    </div>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b bg-white px-6 py-4">
      <div>
        <h1 className="text-[20px] font-semibold text-[#201f1e]">{title}</h1>
        {description && <p className="mt-0.5 max-w-3xl text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Section({ title, description, actions, children, className }: {
  title: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={cn("rounded-sm border bg-white", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div>
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {description && <p className="text-[12px] text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}
