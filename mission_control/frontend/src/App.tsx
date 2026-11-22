import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { AppShell } from "@/components/app-shell"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AnalyzePage } from "@/pages/analyze/analyze-page"
import { ExperimentsPage } from "@/pages/experiments/experiments-page"
import { FineTuningPage } from "@/pages/finetuning/finetuning-page"
import { OverviewPage } from "@/pages/overview/overview-page"
import { MethodologyPage } from "@/pages/methodology/methodology-page"

export default function App() {
  return (
    <BrowserRouter>
      <TooltipProvider delayDuration={200}>
        <AppShell>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/experiments" element={<ExperimentsPage />} />
            <Route path="/analyze" element={<AnalyzePage />} />
            <Route path="/fine-tuning" element={<FineTuningPage />} />
            <Route path="/methodology" element={<MethodologyPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
        <Toaster position="bottom-right" richColors />
      </TooltipProvider>
    </BrowserRouter>
  )
}
