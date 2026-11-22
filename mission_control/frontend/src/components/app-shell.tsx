import { BarChart3, BookOpen, FlaskConical, LayoutDashboard } from "lucide-react"
import { useEffect, useRef, type ReactNode } from "react"
import { Link, NavLink, useLocation } from "react-router-dom"
import dreamLabsLogo from "@/assets/brand/dreamlabs-lockup.svg"
import dreamLabsCloud from "@/assets/brand/dreamlabs-cloud.svg"
import { cn } from "@/lib/utils"

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/experiments", label: "Experiments", icon: FlaskConical },
  { to: "/analyze", label: "Analyze & fine-tune", icon: BarChart3 },
  { to: "/methodology", label: "Methodology", icon: BookOpen },
]

export function AppShell({ children }: { children: ReactNode }) {
  const mainRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()

  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }) }, [pathname])

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="studio-header flex h-[72px] shrink-0 items-center gap-4 border-b px-5 sm:px-7">
        <Link to="/" aria-label="Dream Labs · DreamLoop home" className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><img src={dreamLabsLogo} alt="Dream Labs" className="studio-logo" /></Link>
        <span aria-hidden="true" className="h-5 border-l" />
        <span className="text-[17px] font-medium tracking-tight">DreamLoop</span>
        <span className="studio-label ml-auto hidden rounded-full border bg-card px-3 py-1.5 text-muted-foreground md:inline">Dream-1 studio</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav className="flex w-full shrink-0 gap-1 overflow-x-auto border-b bg-sidebar p-2 sm:w-60 sm:flex-col sm:overflow-y-auto sm:border-r sm:border-b-0 sm:px-3 sm:py-6" aria-label="Main">
          <p className="studio-label hidden px-4 pb-4 text-muted-foreground sm:block">Workspace</p>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => cn(
                "flex shrink-0 items-center gap-3 rounded-full px-4 py-3 text-sm whitespace-nowrap text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                isActive && "bg-brand-peach-tint font-medium text-[#1c1c1c]",
              )}
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
          <div className="mt-auto hidden px-4 pt-12 pb-2 sm:block"><img src={dreamLabsCloud} alt="" aria-hidden="true" className="studio-logo mb-4 max-w-10 opacity-60" /><p className="text-xs leading-relaxed text-muted-foreground">A little more capable.<br />With every experiment.</p></div>
        </nav>
        <main ref={mainRef} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b bg-card px-6 py-7">
      <div>
        <h1 className="text-[30px] leading-tight font-normal tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Section({ title, description, actions, children, className }: {
  title: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
        <div>
          <h2 className="text-base font-medium">{title}</h2>
          {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}
