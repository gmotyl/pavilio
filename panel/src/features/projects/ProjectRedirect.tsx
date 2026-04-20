import { type ReactNode } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { readLastPath } from "../shell/lastPath";

interface Props {
  fallback: ReactNode;
}

export default function ProjectRedirect({ fallback }: Props) {
  const { name } = useParams<{ name: string }>();
  const location = useLocation();
  const current = location.pathname + location.search;
  const stored = name ? readLastPath(name) : null;

  // When the user explicitly navigates to Overview (e.g. via the tab link),
  // skip the "resume where you left off" redirect so they actually land here.
  const explicit = (location.state as { explicit?: boolean } | null)?.explicit === true;

  if (!explicit && stored && stored !== current) {
    return <Navigate replace to={stored} />;
  }
  return <>{fallback}</>;
}
