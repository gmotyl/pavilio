import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { writeLastPath } from "./lastPath";

export function useLastPath(project: string | undefined): void {
  const location = useLocation();
  useEffect(() => {
    if (!project) return;
    writeLastPath(project, location.pathname + location.search);
  }, [project, location.pathname, location.search]);
}
