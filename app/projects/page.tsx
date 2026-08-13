"use client";

import { useEffect, useState } from "react";
import { ProjectTable } from "@/components/ProjectTable";

interface ProjectListRow {
  slug: string;
  displayName: string;
  displayPath: string;
  totalTokens: number;
  costUsd: number;
  lastActiveAt: string | null;
  sessionCount: number;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectListRow[] | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((json) => setProjects(json.projects));
  }, []);

  if (!projects) return <div className="p-8 text-neutral-500">Loading projects…</div>;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <h1 className="text-xl font-semibold">Projects</h1>
      <ProjectTable projects={projects} />
    </main>
  );
}
