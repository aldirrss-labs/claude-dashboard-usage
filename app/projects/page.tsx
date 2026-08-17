"use client";

import { useEffect, useState, useCallback } from "react";
import { ProjectTable } from "@/components/ProjectTable";
import { SyncButton } from "@/components/SyncButton";

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

  const refetch = useCallback(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((json) => setProjects(json.projects));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  if (!projects) {
    return (
      <div className="p-8 text-sm" style={{ color: "var(--text-muted)" }}>
        Loading projects…
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Projects
        </h1>
        <SyncButton onSynced={refetch} />
      </div>
      <ProjectTable projects={projects} />
    </main>
  );
}
