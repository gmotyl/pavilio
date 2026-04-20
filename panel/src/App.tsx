import { BrowserRouter, Routes, Route } from "react-router-dom";
import AgentSettings from "./features/agents/AgentSettings";
import { Login } from "./features/auth/Login";
import TerminalsPage from "./pages/TerminalsPage";
import { useAuthStatus } from "./features/auth/useAuthStatus";
import { ActiveFileProvider } from "./features/explorer/useActiveFile";
import GitPanel from "./features/git/GitPanel";
import MarkdownViewer from "./features/markdown/MarkdownViewer";
import Dashboard from "./features/projects/Dashboard";
import ProjectView from "./features/projects/ProjectView";
import QuickFinder from "./features/search/QuickFinder";
import { BreadcrumbActionsProvider } from "./features/shell/Breadcrumbs";
import { FloatingActionProvider, Layout } from "./features/shell/Layout";

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
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/project/:name" element={<ProjectView />} />
                <Route
                  path="/project/:name/:section"
                  element={<ProjectView />}
                />
                <Route path="/view/*" element={<MarkdownViewer />} />
                <Route path="/git" element={<GitPanel />} />
                <Route path="/settings" element={<AgentSettings />} />
                <Route path="/terminals" element={<TerminalsPage />} />
              </Routes>
            </Layout>
          </FloatingActionProvider>
        </BreadcrumbActionsProvider>
      </ActiveFileProvider>
    </BrowserRouter>
  );
}

export default function App() {
  return <AppShell />;
}
