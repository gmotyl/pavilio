import { useState, useEffect } from "react";

export interface SkillEntry {
  name: string;
  description: string;
  modified: number;
}

export function useSkills() {
  const [skills, setSkills] = useState<SkillEntry[]>([]);

  useEffect(() => {
    fetch("/api/skills")
      .then((res) => (res.ok ? res.json() : []))
      .then(setSkills)
      .catch(() => {});
  }, []);

  return skills;
}
