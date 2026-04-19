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

  if (stored && stored !== current) {
    return <Navigate replace to={stored} />;
  }
  return <>{fallback}</>;
}
