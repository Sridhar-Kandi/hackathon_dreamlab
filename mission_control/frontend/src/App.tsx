import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { AppShell } from "@/components/app-shell"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AnalyzePage } from "@/pages/analyze/analyze-page"
import { ExperimentsPage } from "@/pages/experiments/experiments-page"

export default function App() {
  return (
    <BrowserRouter>
      <TooltipProvider delayDuration={200}>
        <AppShell>
          <Routes>
            <Route path="/" element={<Navigate to="/experiments" replace />} />
            <Route path="/experiments" element={<ExperimentsPage />} />
            <Route path="/analyze" element={<AnalyzePage />} />
            <Route path="*" element={<Navigate to="/experiments" replace />} />
          </Routes>
        </AppShell>
        <Toaster position="bottom-right" richColors />
      </TooltipProvider>
    </BrowserRouter>
  )
}
