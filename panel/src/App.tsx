import { BrowserRouter, Routes, Route } from "react-router-dom";
import { FaviconUpdater } from "./features/favicon/FaviconUpdater";
import { MobileAuthBootstrap } from "./features/mobile-auth/MobileAuthBootstrap";
import AgentSettings from "./features/agents/AgentSettings";
import { Login } from "./features/auth/Login";
import TerminalsPage from "./pages/TerminalsPage";
import ArchivePage from "./pages/ArchivePage";
import { useAuthStatus } from "./features/auth/useAuthStatus";
import { ActiveFileProvider } from "./features/explorer/useActiveFile";
import GitPanel from "./features/git/GitPanel";
import MarkdownViewer from "./features/markdown/MarkdownViewer";
import Dashboard from "./features/projects/Dashboard";
import ProjectRedirect from "./features/projects/ProjectRedirect";
import ProjectView from "./features/projects/ProjectView";
import QuickFinder from "./features/search/QuickFinder";
import QuickTerminalModal from "./features/terminal/QuickTerminalModal";
import { BreadcrumbActionsProvider } from "./features/shell/Breadcrumbs";
import { FloatingActionProvider, Layout } from "./features/shell/Layout";
import { useVisualViewport } from "./features/shell/useVisualViewport";
import { useHostModeRoot } from "./features/host-mode/useHostModeRoot";

function AppShell() {
  const { authRequired, authenticated, loading, recheck } = useAuthStatus();

  if (loading) return null;

  if (authRequired && !authenticated) {
    return <Login onSuccess={recheck} />;
  }

  return (
    <BrowserRouter>
      <ActiveFileProvider>
        <BreadcrumbActionsProvider>
          <FloatingActionProvider>
            <QuickFinder />
            <QuickTerminalModal />
            <FaviconUpdater />
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route
                  path="/project/:name"
                  element={<ProjectRedirect fallback={<ProjectView />} />}
                />
                <Route
                  path="/project/:name/:section"
                  element={<ProjectView />}
                />
                <Route path="/view/*" element={<MarkdownViewer />} />
                <Route path="/git" element={<GitPanel />} />
                <Route path="/settings" element={<AgentSettings />} />
                <Route path="/terminals" element={<TerminalsPage />} />
                <Route path="/archive" element={<ArchivePage />} />
              </Routes>
            </Layout>
          </FloatingActionProvider>
        </BreadcrumbActionsProvider>
      </ActiveFileProvider>
    </BrowserRouter>
  );
}

export default function App() {
  useVisualViewport();
  useHostModeRoot();
  return (
    <MobileAuthBootstrap>
      <AppShell />
    </MobileAuthBootstrap>
  );
}
